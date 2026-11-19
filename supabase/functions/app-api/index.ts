import { constantTimeTextEqual, signSession, verifySession } from '../_shared/auth.ts';

const ADMIN = 'nixan1dev';
const BUCKET = 'chat-files';
const MAX_FILE = 300 * 1024 * 1024;
const MAX_USER_STORAGE = 350 * 1024 * 1024;
const MAX_UPLOADS_PER_HOUR = 100;
const ORPHAN_TTL = 24 * 60 * 60 * 1000;
const ALLOWED_DIAGNOSTICS = new Set([
  'username','ts','url','referrer','language','languages','userAgent','platform','vendor','screen','availScreen',
  'colorDepth','pixelRatio','timezone','cores','memory','online','connection','touchPoints','plugins','cookieEnabled',
  'doNotTrack','battery','geo','fingerprint','storage'
]);
const EMPTY = {
  users: [{ name: ADMIN, role: 'admin', createdAt: 1700000000000 }], events: [], news: [], subjects: [], schedule: [],
  permissions: {}, nicknames: {}, avatars: {}, notifs: [], seenNotifs: {}, banned: [], bannedIps: [], messages: [], fileReservations: []
};

type State = Record<string, any>;
type StateRow = { state: State; revision: number };
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

function supabase() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new HttpError(503, 'Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Supabase.');
  return { url: url.replace(/\/$/, ''), key };
}
function cors(origin: string) {
  const configured = Deno.env.get('ALLOWED_ORIGIN');
  const allow = configured || '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-studia-session, x-upsert',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
function respond(status: number, value: unknown, origin: string) {
  return new Response(JSON.stringify(value), { status, headers: { ...cors(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
async function rest(path: string, method = 'GET', body?: unknown, prefer?: string) {
  const { url, key } = supabase();
  const headers = new Headers({ apikey: key, Authorization: `Bearer ${key}` });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (prefer) headers.set('Prefer', prefer);
  const response = await fetch(`${url}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) throw new HttpError(500, `Error interno de Supabase (${response.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
async function restAll(path: string) {
  const rows: any[] = [];
  const separator = path.includes('?') ? '&' : '?';
  for (let offset = 0; offset < 1_000_000; offset += 1000) {
    const page = await rest(`${path}${separator}limit=1000&offset=${offset}`);
    if (!Array.isArray(page)) throw new HttpError(500, 'Respuesta de lista no válida desde Supabase.');
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
  throw new HttpError(413, 'El chat tiene más de un millón de mensajes; hay que archivar conversaciones antiguas.');
}
async function readState(): Promise<StateRow> {
  const rows = await rest('app_state?select=state,revision&id=eq.1&limit=1');
  if (!rows?.length) throw new HttpError(503, 'No existe app_state. Ejecuta la migración SQL de supabase/migrations en Supabase.');
  const state = { ...structuredClone(EMPTY), ...rows[0].state };
  if (!Array.isArray(state.fileReservations)) state.fileReservations = [];
  return { state, revision: Number(rows[0].revision) };
}
async function mutate<T>(fn: (state: State) => T): Promise<{ state: State; result: T }> {
  // Compare-and-swap por revision: reintenta ante actualizaciones simultáneas y evita perder cambios.
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await readState();
    const next = structuredClone(current.state);
    const result = fn(next);
    const saved = await rest(`app_state?id=eq.1&revision=eq.${current.revision}`, 'PATCH', { state: next, revision: current.revision + 1, updated_at: new Date().toISOString() }, 'return=representation');
    if (saved?.length) return { state: next, result };
  }
  throw new HttpError(409, 'Hay demasiadas modificaciones simultáneas; vuelve a intentarlo.');
}
function clientIp(req: Request) {
  // El proxy de Supabase puede no exponer la IP original en todos los planes/regiones.
  return (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '').split(',')[0].trim() || 'desconocida';
}
function isAdmin(state: State, user: string) { return state.users.some((entry: any) => entry.name === user && entry.role === 'admin'); }
function canChat(state: State, user: string) { return isAdmin(state, user) || state.permissions?.[user]?.chat !== 0; }
function safeName(value: unknown) { return String(value || '').slice(0, 20); }
function encodeObjectPath(path: string) { return path.split('/').map(encodeURIComponent).join('/'); }
async function createSignedUpload(path: string, contentType: string) {
  const { url, key } = supabase();
  const response = await fetch(`${url}/storage/v1/object/upload/sign/${BUCKET}/${encodeObjectPath(path)}`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ upsert: false, contentType })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.token) throw new HttpError(502, `No se pudo preparar la carga de Storage (${response.status}). Comprueba el bucket chat-files.`);
  return `${url}/storage/v1/object/upload/sign/${BUCKET}/${encodeObjectPath(path)}?token=${encodeURIComponent(data.token)}`;
}
async function createSignedDownload(path: string) {
  const { url, key } = supabase();
  const response = await fetch(`${url}/storage/v1/object/sign/${BUCKET}/${encodeObjectPath(path)}`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 300 })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.signedURL) throw new HttpError(404, 'Archivo no encontrado o enlace temporal no disponible.');
  const signed = data.signedURL.startsWith('http') ? data.signedURL : `${url}/storage/v1${data.signedURL.startsWith('/') ? '' : '/'}${data.signedURL}`;
  return signed;
}
async function deleteStoredFile(path: string) {
  const { url, key } = supabase();
  const response = await fetch(`${url}/storage/v1/object/${BUCKET}/${encodeObjectPath(path)}`, {
    method: 'DELETE', headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  return response.ok || response.status === 404;
}
async function listStoredSizes(owner: string) {
  const { url, key } = supabase();
  const sizes = new Map<string, number>();
  for (let offset = 0; offset < 100_000; offset += 1000) {
    const response = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: `${owner}/`, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
    });
    const page = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(page)) throw new HttpError(502, 'No se pudo comprobar el uso real de Supabase Storage.');
    for (const item of page) {
      const bytes = Number(item.metadata?.size);
      if (item.name && Number.isFinite(bytes) && bytes >= 0) {
        const path = String(item.name).includes('/') ? String(item.name) : `${owner}/${item.name}`;
        sizes.set(path, bytes);
      }
    }
    if (page.length < 1000) return sizes;
  }
  throw new HttpError(413, 'La carpeta de adjuntos supera el límite de objetos que se puede contabilizar.');
}
async function loadMessages(state: State) {
  const rows = await restAll('chat_messages?select=message&order=created_at.asc');
  return [...(state.messages || []), ...(rows || []).map((row: any) => row.message).filter(Boolean)].sort((a: any, b: any) => a.ts - b.ts);
}
async function adminDiagnostics() {
  const rows = await rest('collected_diagnostics?select=username,server_ip,server_ts,payload&order=server_ts.desc&limit=2000');
  return (rows || []).map((row: any) => ({ ...row.payload, username: row.username, serverIp: row.server_ip, serverTs: row.server_ts }));
}
async function getUserMessages(user: string) {
  return await restAll(`chat_messages?select=id,user_name,client_id,message&user_name=eq.${encodeURIComponent(user)}`);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '*';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  try {
    if (req.method === 'GET') {
      const token = req.headers.get('x-studia-session');
      const viewer = await verifySession(token);
      if (!viewer) throw new HttpError(401, 'Vuelve a iniciar sesión.');
      const state = (await readState()).state;
      const ip = clientIp(req);
      if (state.banned?.includes(viewer) || (ip !== 'desconocida' && state.bannedIps?.includes(ip))) throw new HttpError(403, 'Cuenta bloqueada.');
      const params = new URL(req.url).searchParams;
      const col = params.get('col') || 'all';
      if (col === 'collected') {
        if (!isAdmin(state, viewer)) throw new HttpError(403, 'Solo el administrador puede consultar estos datos.');
        return respond(200, await adminDiagnostics(), origin);
      }
      if (col === 'file') {
        const objectPath = params.get('id') || '';
        if (!/^[a-z0-9]{2,20}\/[a-f0-9-]{20,60}$/i.test(objectPath)) throw new HttpError(400, 'Identificador de archivo no válido.');
        const referenced = await rest(`chat_messages?select=id&message->>fileId=eq.${encodeURIComponent(objectPath)}&limit=1`);
        if (!referenced?.length) throw new HttpError(404, 'El archivo no está asociado a un mensaje.');
        return respond(200, { signedUrl: await createSignedDownload(objectPath) }, origin);
      }
      if (col !== 'all') throw new HttpError(400, 'Consulta desconocida.');
      const result: any = { ...state };
      delete result.bannedIps;
      delete result.sessions;
      result.messages = await loadMessages(state);
      if (!isAdmin(state, viewer)) {
        result.permissions = { [viewer]: state.permissions?.[viewer] || {} };
        result.seenNotifs = { [viewer]: state.seenNotifs?.[viewer] || [] };
        result.notifs = (state.notifs || []).filter((n: any) => n.target === viewer || n.target === 'all');
        delete result.collected;
      } else {
        result.collected = {};
      }
      return respond(200, result, origin);
    }
    if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido.');
    const raw = await req.text();
    if (raw.length > 26 * 1024 * 1024) throw new HttpError(413, 'La solicitud supera el tamaño permitido.');
    let body: any;
    try { body = JSON.parse(raw || '{}'); } catch { throw new HttpError(400, 'JSON no válido.'); }
    const action = String(body.action || '');
    const username = safeName(body.username);
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
    const ip = clientIp(req);

    if (action === 'login') {
      if (!/^[a-z0-9]{2,20}$/.test(username)) throw new HttpError(400, 'Nombre no válido.');
      const current = (await readState()).state;
      if (ip !== 'desconocida' && current.bannedIps?.includes(ip)) throw new HttpError(403, 'HAS SIDO BLOQUEADO DE ESTA PLATAFORMA');
      if (current.banned?.includes(username)) throw new HttpError(403, 'HAS SIDO BANEADO DE ESTA PLATAFORMA');
      const knownAdmin = username === ADMIN || current.users.some((u: any) => u.name === username && u.role === 'admin');
      if (knownAdmin) {
        const expected = Deno.env.get('ADMIN_PASSWORD') || '';
        if (!expected || !constantTimeTextEqual(String(body.password || ''), expected)) throw new HttpError(403, 'contraseña incorrecta');
      }
      if (!Deno.env.get('SESSION_SECRET') || Deno.env.get('SESSION_SECRET')!.length < 32) throw new HttpError(503, 'Configura SESSION_SECRET en los secretos de Supabase.');
      const { result: user } = await mutate((state) => {
        if (state.banned?.includes(username) || (ip !== 'desconocida' && state.bannedIps?.includes(ip))) throw new HttpError(403, 'Cuenta bloqueada.');
        const isAdminAtCommit = username === ADMIN || state.users.some((u: any) => u.name === username && u.role === 'admin');
        if (isAdminAtCommit) {
          const expected = Deno.env.get('ADMIN_PASSWORD') || '';
          if (!expected || !constantTimeTextEqual(String(body.password || ''), expected)) throw new HttpError(403, 'contraseña incorrecta');
        }
        let found = state.users.find((u: any) => u.name === username);
        if (!found) { found = { name: username, role: 'user', createdAt: Date.now() }; state.users.push(found); }
        return structuredClone(found);
      });
      return respond(200, { ...user, token: await signSession(username) }, origin);
    }

    const token = String(body.token || req.headers.get('x-studia-session') || '');
    const verified = await verifySession(token);
    if (!verified || verified !== username) throw new HttpError(401, 'Vuelve a iniciar sesión.');
    const current = (await readState()).state;
    if (current.banned?.includes(username) || (ip !== 'desconocida' && current.bannedIps?.includes(ip))) throw new HttpError(403, 'Cuenta bloqueada.');

    if (action === 'collect') {
      if (JSON.stringify(payload).length > 32000) throw new HttpError(413, 'Datos demasiado grandes.');
      const clean: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(payload)) if (ALLOWED_DIAGNOSTICS.has(key)) clean[key] = value;
      clean.username = username;
      const serverTs = Date.now();
      await rest('collected_diagnostics', 'POST', { username, server_ip: ip, server_ts: serverTs, payload: clean }, 'return=minimal');
      // Conserva como máximo aproximadamente 2000 registros.
      const cutoff = await rest('collected_diagnostics?select=server_ts&order=server_ts.desc&offset=2000&limit=1');
      if (cutoff?.[0]?.server_ts) await rest(`collected_diagnostics?server_ts=lt.${cutoff[0].server_ts}`, 'DELETE', undefined, 'return=minimal');
      return respond(200, { ok: true }, origin);
    }

    if (action === 'createFileUpload') {
      if (!canChat(current, username)) throw new HttpError(403, 'Sin acceso al chat.');
      const size = Number(payload.size);
      if (!Number.isFinite(size) || size < 0 || size > MAX_FILE) throw new HttpError(413, 'Máximo 300 MB por archivo.');
      const fileId = `${username}/${crypto.randomUUID()}`;
      const now = Date.now();
      const maxProjectStorage = Math.max(MAX_FILE, Number(Deno.env.get('MAX_STUDIA_STORAGE_BYTES')) || 800 * 1024 * 1024);
      const { result: expired } = await mutate(state => {
        state.fileReservations ||= [];
        const stale = state.fileReservations.filter((item: any) => !item.linked && item.createdAt < now - ORPHAN_TTL);
        state.fileReservations = state.fileReservations.filter((item: any) => item.linked || item.createdAt >= now - ORPHAN_TTL);
        return stale;
      });
      for (const stale of expired) {
        if (!await deleteStoredFile(stale.fileId)) await mutate(state => {
          if (!state.fileReservations.some((item: any) => item.fileId === stale.fileId)) state.fileReservations.push(stale);
          return true;
        });
      }
      const snapshot = (await readState()).state;
      const owners = [...new Set([username, ...snapshot.fileReservations.map((item: any) => item.owner).filter(Boolean)])];
      const storedSizes = new Map<string, number>();
      for (const owner of owners) for (const [path, bytes] of await listStoredSizes(String(owner))) storedSizes.set(path, bytes);
      const actualProjectUsage = [...storedSizes.values()].reduce((sum, bytes) => sum + bytes, 0);
      const actualUserUsage = [...storedSizes.entries()].filter(([path]) => path.startsWith(`${username}/`)).reduce((sum, [, bytes]) => sum + bytes, 0);
      await mutate(state => {
        const active = state.fileReservations;
        // Los objetos ya cargados se cuentan por su tamaño real; solo las cargas aún no presentes usan la reserva declarada.
        const pending = active.filter((item: any) => !storedSizes.has(item.fileId));
        const projectUsage = actualProjectUsage + pending.reduce((sum: number, item: any) => sum + Number(item.size || 0), 0);
        const userUsage = actualUserUsage + pending.filter((item: any) => item.owner === username).reduce((sum: number, item: any) => sum + Number(item.size || 0), 0);
        if (userUsage + size > MAX_USER_STORAGE) throw new HttpError(413, 'Has alcanzado el límite de almacenamiento de adjuntos de tu cuenta (350 MB).');
        if (projectUsage + size > maxProjectStorage) throw new HttpError(507, 'Se alcanzó el límite global de almacenamiento configurado para Studia.');
        if (active.filter((item: any) => item.owner === username && item.createdAt > now - 60 * 60 * 1000).length >= 20) throw new HttpError(429, 'Demasiadas cargas; espera un rato y vuelve a intentarlo.');
        if (active.filter((item: any) => item.createdAt > now - 60 * 60 * 1000).length >= MAX_UPLOADS_PER_HOUR) throw new HttpError(429, 'Se alcanzó el límite horario global de cargas; inténtalo más tarde.');
        state.fileReservations.push({ fileId, owner: username, size, createdAt: now, linked: false });
        return true;
      });
      let signedUrl: string;
      try {
        signedUrl = await createSignedUpload(fileId, String(payload.fileType || 'application/octet-stream').slice(0, 120));
      } catch (error) {
        await mutate(state => { state.fileReservations = state.fileReservations.filter((item: any) => item.fileId !== fileId); return true; });
        throw error;
      }
      return respond(200, { fileId, signedUrl }, origin);
    }
    if (action === 'deleteFile') {
      const fileId = String(payload.fileId || '');
      if (!fileId.startsWith(`${username}/`) || !/^[a-z0-9]{2,20}\/[a-f0-9-]{20,60}$/i.test(fileId)) throw new HttpError(403, 'No puedes borrar ese archivo.');
      const referenced = await rest(`chat_messages?select=id&message->>fileId=eq.${encodeURIComponent(fileId)}&limit=1`);
      if (referenced?.length) throw new HttpError(409, 'El archivo ya está publicado en el chat.');
      if (!await deleteStoredFile(fileId)) throw new HttpError(502, 'No se pudo borrar el adjunto en Storage.');
      await mutate(state => { state.fileReservations = state.fileReservations.filter((item: any) => item.fileId !== fileId); return true; });
      return respond(200, { ok: true }, origin);
    }

    if (action === 'message') {
      if (!canChat(current, username)) throw new HttpError(403, 'Sin acceso al chat.');
      const clientId = String(payload.clientId || crypto.randomUUID());
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(clientId)) throw new HttpError(400, 'Mensaje no válido.');
      const fileId = payload.fileId ? String(payload.fileId) : null;
      if (fileId && !fileId.startsWith(`${username}/`)) throw new HttpError(403, 'No puedes adjuntar ese archivo.');
      if (fileId && !current.fileReservations.some((item: any) => item.fileId === fileId && item.owner === username && item.createdAt >= Date.now() - ORPHAN_TTL)) throw new HttpError(400, 'La carga del adjunto ha caducado o no pertenece a esta cuenta.');
      const message = {
        id: Date.now() + Math.random(), user: username, clientId,
        body: String(payload.body || '').slice(0, 2000),
        fileName: payload.fileName ? String(payload.fileName).slice(0, 255) : null,
        fileType: payload.fileType ? String(payload.fileType).slice(0, 120) : null,
        fileId, fileData: payload.fileData ? String(payload.fileData).slice(0, 5_600_000) : null,
        ts: Date.now()
      };
      await rest('chat_messages?on_conflict=user_name,client_id', 'POST', { user_name: username, client_id: clientId, message }, 'resolution=ignore-duplicates,return=representation');
      if (fileId) await mutate(state => {
        const reservation = state.fileReservations.find((item: any) => item.fileId === fileId && item.owner === username);
        if (!reservation) throw new HttpError(400, 'La reserva del archivo caducó antes de publicar el mensaje.');
        reservation.linked = true;
        return true;
      });
      const rows = await rest(`chat_messages?select=message&user_name=eq.${encodeURIComponent(username)}&client_id=eq.${encodeURIComponent(clientId)}&limit=1`);
      return respond(200, rows?.[0]?.message || message, origin);
    }

    if (action === 'setAvatar') {
      const data = String(payload.avatar || '');
      if (!/^data:image\/(png|jpeg|gif|webp);base64,[a-zA-Z0-9+/=]+$/.test(data)) throw new HttpError(400, 'Imagen no válida.');
      if (data.length > 700 * 1024) throw new HttpError(413, 'Avatar demasiado grande (máx. 500 KB).');
      await mutate(state => { state.avatars[username] = data; return true; });
      return respond(200, { ok: true }, origin);
    }

    if (action === 'ackNotifs') {
      await mutate(state => {
        const seen = state.seenNotifs[username] ||= [];
        for (const id of payload.ids || []) if (id != null && !seen.includes(String(id))) seen.push(String(id));
        state.seenNotifs[username] = seen.slice(-200);
        return true;
      });
      return respond(200, { ok: true }, origin);
    }

    const before = current;
    const admin = isAdmin(before, username);
    const isMod = before.users.find((u: any) => u.name === username)?.role === 'modder';
    let rename: { oldName: string; newName: string } | null = null;
    if (action === 'delMessage') {
      if (!admin) throw new HttpError(403, 'Sin permiso.');
      const all = await loadMessages(before);
      const target = all.find((m: any) => String(m.id) === String(payload.id));
      if (target?.fileId && !await deleteStoredFile(String(target.fileId))) throw new HttpError(502, 'No se pudo borrar el adjunto en Storage.');
      if (target?.clientId) await rest(`chat_messages?user_name=eq.${encodeURIComponent(target.user)}&client_id=eq.${encodeURIComponent(target.clientId)}`, 'DELETE', undefined, 'return=minimal');
      await mutate(state => {
        state.messages = state.messages.filter((m: any) => String(m.id) !== String(payload.id));
        if (target?.fileId) state.fileReservations = state.fileReservations.filter((item: any) => item.fileId !== target.fileId);
        return true;
      });
      return respond(200, { ok: true }, origin);
    }

    const { result } = await mutate((state) => {
      const target = state.users.find((u: any) => u.name === payload.target);
      switch (action) {
        case 'addEvent':
          if (!admin && !(isMod && state.permissions[username]?.modCalendar)) throw new HttpError(403, 'sin permiso');
          state.events.push({ id: Date.now(), title: String(payload.title || '').slice(0, 100), date: String(payload.date || ''), by: username }); return { ok: true };
        case 'delEvent':
          if (!admin && !(isMod && state.permissions[username]?.modCalendar)) throw new HttpError(403, 'sin permiso');
          state.events = state.events.filter((e: any) => String(e.id) !== String(payload.id)); return { ok: true };
        case 'addNews':
          if (!admin && !(isMod && state.permissions[username]?.modNews)) throw new HttpError(403, 'sin permiso');
          state.news.push({ id: Date.now(), title: String(payload.title || '').slice(0, 150), body: String(payload.body || '').slice(0, 5000), author: username, ts: Date.now() }); return { ok: true };
        case 'delNews':
          if (!admin) throw new HttpError(403, 'sin permiso');
          state.news = state.news.filter((n: any) => String(n.id) !== String(payload.id)); return { ok: true };
        case 'setSchedule':
          if (!admin && !(isMod && state.permissions[username]?.modSchedule)) throw new HttpError(403, 'sin permiso');
          state.schedule = Array.isArray(payload.schedule) ? payload.schedule : []; return { ok: true };
        case 'addSubject':
          if (!admin) throw new HttpError(403, 'sin permiso');
          state.subjects.push({ id: Date.now(), name: String(payload.name || '').slice(0, 60), resumen: '', tests: [] }); return { ok: true };
        case 'updateSubject': {
          if (!admin) throw new HttpError(403, 'sin permiso');
          const subject = state.subjects.find((s: any) => String(s.id) === String(payload.id));
          if (!subject) throw new HttpError(404, 'no existe');
          if (payload.name !== undefined) subject.name = String(payload.name).slice(0, 60);
          if (payload.resumen !== undefined) subject.resumen = String(payload.resumen).slice(0, 50000);
          if (payload.tests !== undefined) subject.tests = payload.tests;
          return { ok: true };
        }
        case 'delSubject':
          if (!admin) throw new HttpError(403, 'sin permiso');
          state.subjects = state.subjects.filter((s: any) => String(s.id) !== String(payload.id)); return { ok: true };
        case 'adminPatch': {
          if (!admin) throw new HttpError(403, 'sin permiso');
          if (!target) throw new HttpError(404, 'no existe');
          if (payload.role !== undefined) {
            if (!['user','modder','admin'].includes(payload.role) || (target.name === ADMIN && payload.role !== 'admin')) throw new HttpError(400, 'Rango no permitido');
            target.role = payload.role;
          }
          if (payload.nickname !== undefined) state.nicknames[target.name] = String(payload.nickname).slice(0, 30);
          if (payload.section !== undefined) { state.permissions[target.name] ||= {}; state.permissions[target.name][payload.section] = payload.value ? 1 : 0; }
          if (payload.sections && typeof payload.sections === 'object') {
            state.permissions[target.name] ||= {};
            for (const [key, value] of Object.entries(payload.sections)) state.permissions[target.name][key] = value ? 1 : 0;
          }
          if (payload.newName) {
            if (target.name === ADMIN) throw new HttpError(400, 'No se puede renombrar al administrador principal');
            const newName = String(payload.newName).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
            if (!newName || state.users.some((u: any) => u.name === newName && u !== target)) throw new HttpError(409, 'nombre no válido o ya existe');
            const oldName = target.name;
            state.permissions[newName] = state.permissions[oldName] || {}; delete state.permissions[oldName];
            state.nicknames[newName] = state.nicknames[oldName] || ''; delete state.nicknames[oldName];
            state.avatars[newName] = state.avatars[oldName] || ''; delete state.avatars[oldName];
            state.notifs.forEach((n: any) => { if (n.target === oldName) n.target = newName; });
            state.seenNotifs[newName] = state.seenNotifs[oldName] || []; delete state.seenNotifs[oldName];
            state.banned = state.banned.map((name: string) => name === oldName ? newName : name);
            rename = { oldName, newName };
            target.name = newName;
          }
          if (payload.ban === true && !state.banned.includes(target.name)) state.banned.push(target.name);
          if (payload.unban === true) state.banned = state.banned.filter((name: string) => name !== target.name);
          return { ok: true };
        }
        case 'banIp': {
          if (!admin) throw new HttpError(403, 'sin permiso');
          const value = String(payload.ip || '');
          if (value && !state.bannedIps.includes(value)) state.bannedIps.push(value);
          return { ok: true };
        }
        case 'notif':
          if (!admin) throw new HttpError(403, 'sin permiso');
          state.notifs.push({ id: Date.now() + Math.random(), target: payload.target === 'all' ? 'all' : String(payload.target || ''), text: String(payload.text || '').slice(0, 300), ts: Date.now() });
          state.notifs = state.notifs.filter((n: any) => n.ts > Date.now() - 7 * 864e5).slice(-100); return { ok: true };
        default: throw new HttpError(400, 'Acción desconocida.');
      }
    });

    if (action === 'adminPatch' && payload.ban === true) {
      const diag = await rest(`collected_diagnostics?select=server_ip&username=eq.${encodeURIComponent(String(payload.target || ''))}&order=server_ts.desc&limit=1`);
      const bannedIp = diag?.[0]?.server_ip;
      if (bannedIp && bannedIp !== 'desconocida') await mutate(state => { if (!state.bannedIps.includes(bannedIp)) state.bannedIps.push(bannedIp); return true; });
    }
    if (action === 'adminPatch' && payload.unban === true) {
      const ips = await rest(`collected_diagnostics?select=server_ip&username=eq.${encodeURIComponent(String(payload.target || ''))}&limit=2000`);
      const values = new Set((ips || []).map((row: any) => row.server_ip).filter(Boolean));
      await mutate(state => { state.bannedIps = state.bannedIps.filter((value: string) => !values.has(value)); return true; });
    }
    const renamed = rename as { oldName: string; newName: string } | null;
    if (renamed) {
      const rows = await getUserMessages(renamed.oldName);
      for (const row of rows || []) {
        const message = { ...row.message, user: renamed.newName };
        await rest(`chat_messages?id=eq.${encodeURIComponent(row.id)}`, 'PATCH', { user_name: renamed.newName, message }, 'return=minimal');
      }
    }
    return respond(200, result, origin);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Error interno.';
    console.error('app-api error:', status, message);
    return respond(status, { error: message }, origin);
  }
});
