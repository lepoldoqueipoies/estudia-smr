import { store } from '../store.js';
import { toast, fmtDate, roleBadge, escapeHTML } from '../ui.js';
import { api } from '../api.js';

export function perfilView() {
  const me = store.current();
  const nick = store.nick(me.name);
  const av = store.avatar(me.name);

  return `
    <div class="page-head">
      <div>
        <h1>Mi perfil</h1>
        <p>Tu información pública</p>
      </div>
    </div>
    <div class="grid grid-2">
      <div class="card" style="text-align:center">
        <div id="avatarWrap" style="width:96px;height:96px;border-radius:50%;margin:0 auto 14px;overflow:hidden;border:2px solid var(--line);display:grid;place-items:center;background:var(--bg);font-size:2rem;font-weight:700;cursor:pointer" title="Cambiar foto">
          ${av ? `<img src="${escapeHTML(av)}" style="width:100%;height:100%;object-fit:cover">` : me.name.charAt(0).toUpperCase()}
        </div>
        <h3>${escapeHTML(me.name)}</h3>
        ${nick ? `<p>apodo: ${escapeHTML(nick)}</p>` : ''}
        <div style="margin-top:8px">${roleBadge(me.role)}</div>
        <input type="file" id="avatarInput" accept="image/*" style="display:none">
      </div>
      <div class="card">
        <h3>Detalles</h3>
        <table>
          <tr><td style="color:var(--muted)">Rango</td><td>${me.role}</td></tr>
          <tr><td style="color:var(--muted)">Creado</td><td>${fmtDate(me.createdAt)}</td></tr>
          <tr><td style="color:var(--muted)">Apodo</td><td>${escapeHTML(nick || '—')}</td></tr>
        </table>
        <h3 style="margin-top:16px">Actividad reciente</h3>
        <div id="activityList"></div>
      </div>
    </div>
  `;
}

export function bindPerfil() {
  const me = store.current();
  const wrap = document.getElementById('avatarWrap');
  const input = document.getElementById('avatarInput');

  if (wrap && input) {
    wrap.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 500 * 1024) {
        toast('máximo 500 KB', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        store.data.avatars[me.name] = reader.result;
        store.save();
        // compartir el avatar con los demás
        api.send({ action: 'setAvatar', username: me.name, payload: { avatar: reader.result } })
          .then(() => toast('foto actualizada y compartida'))
          .catch(() => toast('foto guardada solo en local'));
        wrap.innerHTML = `<img src="${escapeHTML(reader.result)}" style="width:100%;height:100%;object-fit:cover">`;
      };
      reader.readAsDataURL(file);
    });
  }

  const act = document.getElementById('activityList');
  if (act) {
    const myMessages = store.data.messages.filter(m => m.user === me.name).slice(-5).reverse();
    act.innerHTML = myMessages.length
      ? myMessages.map(m => `<p style="font-size:.8rem;margin-bottom:4px">💬 ${escapeHTML(m.body || '[archivo]')}</p>`).join('')
      : '<p>Sin actividad reciente.</p>';
  }
}
