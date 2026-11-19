import { store } from '../store.js';
import { toast, escapeHTML, avatarHTML, nameTag, fmtTime } from '../ui.js';
import { api } from '../api.js';

export function chatView() {
  const isAdmin = store.current()?.role === 'admin';
  return `
    <div class="page-head">
      <div>
        <h1>Chat</h1>
        <p>Habla con la clase y comparte archivos (hasta 300 MB por archivo)</p>
      </div>
    </div>
    <div class="card">
      <div class="chat-area">
        <div class="chat-messages" id="chatMessages"></div>
        <div class="chat-input-bar">
          <label class="chat-attach" title="Adjuntar archivo">
            📎
            <input type="file" id="chatFile" style="display:none">
          </label>
          <input id="chatInput" placeholder="Escribe un mensaje..." maxlength="2000">
          <button class="btn primary" id="chatSend">Enviar</button>
        </div>
        <div id="fileLabel" style="font-size:.75rem;color:var(--muted);margin-top:6px;min-height:1em"></div>
      </div>
    </div>
  `;
}

function msgHTML(m) {
  const me = store.current();
  const mine = m.user === me.name;
  const isAdmin = me.role === 'admin';
  const fileHTML = m.fileName
    ? `<a class="chat-file" href="#" data-dl="${m.id}">📄 ${escapeHTML(m.fileName)}</a>`
    : '';
  const delHTML = isAdmin
    ? ` <button class="btn small danger" data-del="${m.id}" style="margin-left:6px">✕</button>`
    : '';
  return `
    <div class="chat-msg ${mine ? 'mine' : ''}">
      ${avatarHTML(m.user)}
      <div>
        <div class="chat-bubble">
          <div class="chat-meta">${nameTag(m.user)} · ${fmtTime(m.ts)}${delHTML}</div>
          ${m.body ? `<div class="chat-text">${escapeHTML(m.body)}</div>` : ''}
          ${fileHTML}
          ${m.pending ? '<small class="message-state">Enviando…</small>' : m.failed ? `<button class="btn small danger" data-retry="${m.clientId}">Reintentar envío</button>` : '<small class="message-state">✓ Enviado</small>'}
        </div>
      </div>
    </div>
  `;
}

function render() {
  const host = document.getElementById('chatMessages');
  if (!host) return;
  host.innerHTML = store.data.messages.map(msgHTML).join('');
  const nearBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 100;
  if (nearBottom || !host.dataset.rendered) host.scrollTop = host.scrollHeight;
  host.dataset.rendered = '1';
}

export function bindChat() {
  render();

  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSend');
  const fileInput = document.getElementById('chatFile');
  const fileLabel = document.getElementById('fileLabel');
  const host = document.getElementById('chatMessages');

  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    fileLabel.textContent = f ? `adjunto: ${f.name} (${(f.size / 1024).toFixed(0)} KB)` : '';
  });

  let sending = false;
  async function send() {
    if (sending) return;
    const body = input.value.trim();
    const file = fileInput.files[0];
    if (!body && !file) return;

    if (file?.size > 300 * 1024 * 1024) { toast("Máximo 300 MB por archivo", "error"); return; }
    sending = true; sendBtn.disabled = true;
    let fileName = null, fileType = null, fileId = null;
    if (file) {
      fileName = file.name;
      fileType = file.type;
      toast(`subiendo ${file.name} a Supabase Storage...`);
      try {
        fileId = await api.uploadFile(file);
      } catch (e) {
        toast('fallo al subir: ' + e.message, 'error');
        sending = false; sendBtn.disabled = false; return;
      }
    }

    const me = store.current();
    const msg = {
      id: Date.now() + Math.random(),
      clientId: crypto.randomUUID(), pending: true,
      user: me.name,
      body,
      ts: Date.now(),
      fileName,
      fileType,
      fileId,
    };
    store.data.messages.push(msg);
    store.save();
    input.value = '';
    fileInput.value = '';
    fileLabel.textContent = '';
    render();

    try {
      const saved = await api.send({
        action: 'message',
        username: me.name,
        payload: { body, fileName, fileType, fileId, clientId: msg.clientId }
      });
      Object.assign(msg, saved, { pending: false, failed: false });
      store.save();
      render();
    } catch (e) {
      msg.pending = false; msg.failed = true; store.save(); render();
      toast('No se ha enviado: ' + e.message, 'error');
    } finally {
      sending = false; sendBtn.disabled = false;
    }
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') send();
  });

  // descarga de archivos
  host.addEventListener('click', async e => {
    const retry = e.target.closest('[data-retry]');
    if (retry) {
      const m = store.data.messages.find(x => x.clientId === retry.dataset.retry);
      if (!m || m.pending) return;
      m.pending = true; render();
      try { const saved = await api.send({action:'message', username:store.current().name, payload:m}); Object.assign(m,saved,{pending:false,failed:false}); }
      catch (err) { m.pending=false; m.failed=true; toast(err.message,'error'); }
      store.save(); render(); return;
    }
    const dl = e.target.closest('[data-dl]');
    if (dl) {
      e.preventDefault();
      const m = store.data.messages.find(x => String(x.id) === String(dl.dataset.dl));
      if (!m) return;
      try {
        let base64 = m.fileData;
        let type = m.fileType;
        if (!base64 && m.fileId) {
          const remote = await api.getFile(m.fileId);
          if (!remote?.signedUrl) {
            toast('archivo no disponible', 'error');
            return;
          }
          const response = await fetch(remote.signedUrl);
          if (!response.ok) throw new Error(`Descarga fallida (${response.status})`);
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = m.fileName || 'adjunto';
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 30_000);
          return;
        }
        if (base64) {
          const a = document.createElement('a');
          a.href = `data:${type};base64,${base64}`;
          a.download = m.fileName;
          a.click();
        }
      } catch (err) {
        toast('fallo al descargar: ' + err.message, 'error');
      }
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const id = del.dataset.del;
      store.data.messages = store.data.messages.filter(x => String(x.id) !== String(id));
      store.save();
      api.send({ action: 'delMessage', username: store.current().name, payload: { id } });
      render();
    }
  });

  let stopped = false, timer;
  async function sync() {
    if (stopped) return;
    if (!document.hidden) {
      const before = JSON.stringify(store.data.messages);
      await api.syncAll();
      if (!stopped && before !== JSON.stringify(store.data.messages)) render();
    }
    if (!stopped) timer = setTimeout(sync, store.data.online ? 1000 : 5000);
  }
  const resume = () => { if (!document.hidden && !stopped) { clearTimeout(timer); sync(); } };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('studia:navigate', () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange',resume); }, {once:true});
  timer = setTimeout(sync, 1000);
}
