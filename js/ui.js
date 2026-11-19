import { store } from './store.js';
import { api } from './api.js';

export function toast(msg, type = 'ok') {
  const host = document.getElementById('toastHost');
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'error' ? ' error' : '');
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

export function modal(title, bodyHTML, actions = []) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `
    <div class="modal">
      <h3>${title}</h3>
      <div class="modal-body">${bodyHTML}</div>
      <div class="modal-actions"></div>
    </div>
  `;
  const actHost = wrap.querySelector('.modal-actions');
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.primary ? 'primary' : '');
    b.textContent = a.label;
    b.addEventListener('click', async () => {
      if (b.disabled) return; b.disabled=true;
      try { if (a.onClick && await a.onClick(wrap) === false) return; await api.settleWrites(); wrap.remove(); }
      catch(e) { toast('No se guardó: '+e.message,'error'); }
      finally { b.disabled=false; }
    });
    actHost.appendChild(b);
  }
  wrap.addEventListener('click', e => {
    if (e.target === wrap) wrap.remove();
  });
  document.body.appendChild(wrap);
  return wrap;
}

export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

export function escapeHTML(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function avatarHTML(name, size = 34) {
  const av = store.avatar(name);
  const letter = name.charAt(0).toUpperCase();
  const img = av
    ? `<img src="${escapeHTML(av)}" alt="">`
    : letter;
  return `<div class="chat-avatar" style="width:${size}px;height:${size}px;font-size:${size * 0.35}px">${img}</div>`;
}

export function nameTag(name) {
  const nick = store.nick(name);
  const nickPart = nick ? ` <span class="chat-nick">(${escapeHTML(nick)})</span>` : '';
  return `<b>${escapeHTML(name)}</b>${nickPart}`;
}

export function roleBadge(role) {
  const label = role === 'admin' ? 'admin' : role === 'modder' ? 'modder' : 'user';
  return `<span class="badge ${label}">${label}</span>`;
}
