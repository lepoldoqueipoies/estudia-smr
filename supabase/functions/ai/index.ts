import { verifySession } from '../_shared/auth.ts';

function cors() {
  return {
    'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-studia-session',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
function json(status: number, error: string) {
  return new Response(JSON.stringify({ error }), { status, headers: { ...cors(), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
async function state() {
  const url = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Faltan secretos de Supabase.');
  const res = await fetch(`${url}/rest/v1/app_state?select=state&id=eq.1&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error('No se pudo leer el estado de Studia.');
  return (await res.json())?.[0]?.state;
}
function encodeObjectPath(path: string) { return path.split('/').map(encodeURIComponent).join('/'); }
async function contentsWithStoredFiles(contents: any[], user: string) {
  const url = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Faltan secretos de Supabase.');
  return await Promise.all(contents.map(async (item: any) => ({
    ...item,
    parts: await Promise.all((item.parts || []).map(async (part: any) => {
      if (!part?.storageFile) return part;
      const fileId = String(part.storageFile.fileId || '');
      if (!fileId.startsWith(`${user}/`) || !/^[a-z0-9]{2,20}\/[a-f0-9-]{20,60}$/i.test(fileId)) throw new Error('Adjunto temporal no válido.');
      const response = await fetch(`${url}/storage/v1/object/chat-files/${encodeObjectPath(fileId)}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      if (!response.ok) throw new Error('No se pudo leer un adjunto temporal de Storage.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 16 * 1024 * 1024) throw new Error('El adjunto supera el límite de la IA.');
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      return { inlineData: { mimeType: String(part.storageFile.mimeType || 'application/octet-stream'), data: btoa(binary) } };
    }))
  })));
}
Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (request.method !== 'POST') return json(405, 'Método no permitido');
  try {
    const raw = await request.text();
    if (raw.length > 24 * 1024 * 1024) return json(413, 'Los adjuntos superan el tamaño permitido por la IA');
    const body = JSON.parse(raw);
    const user = await verifySession(request.headers.get('x-studia-session'));
    if (!user) return json(401, 'Vuelve a iniciar sesión');
    const data = await state();
    if (!data?.users?.some((entry: any) => entry.name === user && entry.role === 'admin')) return json(403, 'Solo el administrador puede usar la IA');
    if (data?.banned?.includes(user)) return json(403, 'Cuenta bloqueada');
    const key = Deno.env.get('GEMINI_API_KEY');
    const model = Deno.env.get('GEMINI_MODEL');
    if (!key || !model) return json(503, 'Configura GEMINI_API_KEY y GEMINI_MODEL en Supabase Edge Function Secrets');
    if (!/^[a-zA-Z0-9._-]+$/.test(model)) return json(503, 'GEMINI_MODEL no es válido');
    if (!Array.isArray(body.contents) || !body.contents.length || body.contents.length > 24) return json(400, 'Conversación no válida');
    const contents = await contentsWithStoredFiles(body.contents, user);
    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents, generationConfig: { temperature: Math.min(1, Math.max(0, Number(body.temperature) || 0.4)), maxOutputTokens: 8192 } }),
      signal: request.signal
    });
    if (!upstream.ok) {
      const data = await upstream.json().catch(() => ({}));
      const message = String(data.error?.message || `Gemini respondió con un error (${upstream.status})`).replaceAll(key, '[clave oculta]');
      return json(upstream.status, message);
    }
    return new Response(upstream.body, { headers: { ...cors(), 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Gemini-Model': model } });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return json(aborted ? 499 : 500, aborted ? 'Respuesta detenida' : 'No se pudo procesar la solicitud de IA');
  }
});
