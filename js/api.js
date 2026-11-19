// Adaptador del frontend: archivos estáticos en GitHub Pages y backend en Supabase Edge Functions.
import { store } from './store.js';
import { FUNCTIONS_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from './config.js';

let pendingWrites = new Set();
function assertConfigured() {
  if (!isSupabaseConfigured()) throw new Error('Falta configurar js/config.js con la URL y la clave pública de Supabase.');
}
async function call(query = '', opts = {}) {
  assertConfigured();
  const headers = new Headers(opts.headers || {});
  headers.set('apikey', SUPABASE_ANON_KEY);
  // La clave pública satisface el gateway; el token Studia se envía en una cabecera aparte.
  headers.set('Authorization', `Bearer ${SUPABASE_ANON_KEY}`);
  headers.set('x-studia-session', store.data.adminToken || '');
  if (opts.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${FUNCTIONS_URL}/app-api${query}`, { ...opts, headers, cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Error del servidor (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
export const api = {
  async settleWrites() {
    const batch = [...pendingWrites];
    const results = await Promise.allSettled(batch);
    batch.forEach(task => pendingWrites.delete(task));
    const failed = results.find(r => r.status === 'rejected');
    if (failed) { await this.syncAll(); throw failed.reason; }
  },
  async collect(payload) {
    return call('', { method: 'POST', body: JSON.stringify({ action: 'collect', username: store.data.session, payload }) });
  },
  async collected() { return call('?col=collected'); },
  async login(username, password) {
    const data = await call('', { method: 'POST', body: JSON.stringify({ action: 'login', username, password }) });
    if (data?.token) { store.data.adminToken = data.token; store.save(); }
    return data;
  },
  async syncAll() {
    try {
      const data = await call('?col=all');
      if (data && typeof data === 'object' && 'users' in data) {
        store.data.users = data.users;
        const pending = store.data.messages.filter(m => m.pending || m.failed);
        store.data.messages = [...(data.messages || []), ...pending.filter(m => !(data.messages || []).some(r => r.clientId === m.clientId))].sort((a, b) => a.ts - b.ts);
        for (const key of ['events', 'news', 'subjects', 'schedule', 'permissions', 'nicknames', 'avatars', 'notifs', 'seenNotifs', 'banned']) {
          store.data[key] = data[key] || (['permissions', 'nicknames', 'avatars', 'seenNotifs'].includes(key) ? {} : []);
        }
        store.data.collected = data.collected || store.data.collected || {};
        store.data.online = true;
        store.save();
        return true;
      }
      return false;
    } catch {
      store.data.online = false;
      return false;
    }
  },
  send(opts) {
    const task = this.sendRequest(opts);
    pendingWrites.add(task);
    task.then(() => pendingWrites.delete(task), () => {});
    task.catch(() => {});
    return task;
  },
  async sendRequest(opts) {
    return call('', { method: 'POST', body: JSON.stringify({ ...opts, token: store.data.adminToken }) });
  },
  async ackNotifs(ids) {
    if (!ids.length || !store.data.session) return;
    const me = store.data.session;
    const seen = store.data.seenNotifs[me] = store.data.seenNotifs[me] || [];
    for (const id of ids) if (!seen.includes(String(id))) seen.push(String(id));
    store.data.seenNotifs[me] = seen.slice(-200);
    store.save();
    try { await this.send({ action: 'ackNotifs', username: me, payload: { ids: ids.map(String) } }); } catch {}
  },
  // El navegador carga el binario a Storage mediante una URL firmada de un solo uso.
  async uploadFile(file, onProgress) {
    if (file.size > 300 * 1024 * 1024) throw new Error('Máximo 300 MB por archivo');
    const result = await this.sendRequest({
      action: 'createFileUpload', username: store.data.session,
      payload: { fileName: file.name, fileType: file.type || 'application/octet-stream', size: file.size }
    });
    const response = await fetch(result.signedUrl, {
      method: 'PUT',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' },
      body: file
    });
    if (!response.ok) throw new Error(`Supabase Storage rechazó el archivo (${response.status}). Revisa el límite configurado para el bucket.`);
    if (onProgress) onProgress(100);
    return result.fileId;
  },
  async getFile(id) { return call(`?col=file&id=${encodeURIComponent(id)}`); }
};
