import { store } from '../store.js';
import { toast, modal, escapeHTML, fmtDate, roleBadge } from '../ui.js';
import { api } from '../api.js';



export function perfilesView() {
  return `
    <div class="page-head">
      <div>
        <h1>Perfiles</h1>
        <p>Solo admin · toda la información de cada usuario</p>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn primary" id="notifAllBtn">🔔 Aviso a todos</button>
        <button class="btn" id="viewCollectedBtn">📡 Datos recolectados</button>
      </div>
    </div>
    <div class="card perf-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Usuario</th><th>Rango</th><th>Apodo</th><th>Creado</th>
            <th>Datos</th><th>Acciones</th>
          </tr>
        </thead>
        <tbody id="userRows"></tbody>
      </table>
    </div>
  `;
}

function render() {
  const tbody = document.getElementById('userRows');
  if (!tbody) return;

  tbody.innerHTML = store.data.users.map(u => {
    const isBanned = store.data.banned.includes(u.name);
    const info = store.data.collected?.[u.name] || {};
    return `
      <tr>
        <td><b>${escapeHTML(u.name)}</b> ${isBanned ? '<span class="badge red">baneado</span>' : ''}</td>
        <td>${roleBadge(u.role)}</td>
        <td>${escapeHTML(store.nick(u.name)) || '<span style="color:var(--muted)">—</span>'}</td>
        <td>${fmtDate(u.createdAt)}</td>
        <td>
          <button class="btn small" data-info="${u.name}">Ver info</button>
        </td>
        <td>
          <div class="perf-actions">
            <button class="btn small" data-edit="${u.name}">Editar</button>
            <button class="btn small" data-notif="${u.name}">🔔</button>
            ${u.name !== 'nixan1dev' ? `
              ${isBanned
                ? `<button class="btn small" data-unban="${u.name}">Desbanear</button>`
                : `<button class="btn small danger" data-ban="${u.name}">Banear</button>`}` : ''}
          </div>
        </td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-info]').forEach(btn => {
    btn.addEventListener('click', () => showInfo(btn.dataset.info));
  });
  tbody.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => editUser(btn.dataset.edit));
  });
  tbody.querySelectorAll('[data-notif]').forEach(btn => {
    btn.addEventListener('click', () => sendNotif(btn.dataset.notif));
  });
  tbody.querySelectorAll('[data-ban]').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.ban;
      if (!store.data.banned.includes(name)) store.data.banned.push(name);
      store.save();
      api.send({ action: 'adminPatch', username: store.current().name, payload: { target: name, ban: true } })
        .then(() => toast(`${name} baneado, su IP quedó bloqueada`));
      render();
    });
  });
  tbody.querySelectorAll('[data-unban]').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.unban;
      store.data.banned = store.data.banned.filter(n => n !== name);
      store.save();
      api.send({ action: 'adminPatch', username: store.current().name, payload: { target: name, unban: true } })
        .then(() => toast(`${name} desbaneado`));
      render();
    });
  });
}

function showInfo(name) {
  const info = store.data.collected?.[name] || {};
  const rows = [
    ['Usuario', name],
    ['IP (servidor)', info.serverIp || info.ip || '—'],
    ['User agent', info.userAgent || '—'],
    ['Idioma', info.language || '—'],
    ['Pantalla', info.screen || '—'],
    ['Zona horaria', info.timezone || '—'],
    ['Plataforma', info.platform || '—'],
    ['Núcleos', info.cores || '—'],
    ['Memoria', info.memory ? info.memory + ' GB' : '—'],
    ['Conexión', info.connection ? JSON.stringify(info.connection) : '—'],
    ['Batería', info.battery ? `${Math.round(info.battery.level * 100)}% cargando:${info.battery.charging}` : '—'],
    ['Ubicación', info.geo ? `${info.geo.lat}, ${info.geo.lng} (±${info.geo.accuracy}m)` : '—'],
    ['Huella', info.fingerprint || '—'],
    ['Referrer', info.referrer || '—'],
    ['Cookies', info.cookieEnabled ? 'sí' : 'no'],
    ['Recogido', info.ts ? new Date(info.ts).toLocaleString('es-ES') : '—']
  ];

  modal(`Info de ${escapeHTML(name)}`, `
    <table>
      ${rows.map(([k, v]) => `<tr><td style="color:var(--muted);font-size:.75rem">${k}</td><td style="font-size:.78rem;word-break:break-all">${escapeHTML(String(v))}</td></tr>`).join('')}
    </table>
  `, [{ label: 'Cerrar' }]);
}

function editUser(name) {
  const u = store.user(name);
  if (!u) return;

  const sections = ['calendar', 'exams', 'chat', 'news', 'schedule'];
  const perms = store.data.permissions[name] || {};

  const m = modal(`Editar ${escapeHTML(name)}`, `
    <div class="field">
      <label>Nuevo nombre (vacío = no cambiar)</label>
      <input id="edName" placeholder="${escapeHTML(u.name)}">
    </div>
    <div class="field">
      <label>Apodo (visible para todos entre paréntesis)</label>
      <input id="edNick" value="${escapeHTML(store.nick(name))}">
    </div>
    <div class="field">
      <label>Rango</label>
      <select id="edRole">
        <option value="user" ${u.role === 'user' ? 'selected' : ''}>user</option>
        <option value="modder" ${u.role === 'modder' ? 'selected' : ''}>modder</option>
        ${u.name === 'nixan1dev' ? '' : `<option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>`}
      </select>
    </div>
    <h3 style="margin:14px 0 8px">Acceso a secciones</h3>
    ${sections.map(s => `
      <label style="display:flex;align-items:center;gap:8px;font-size:.85rem;margin-bottom:6px">
        <input type="checkbox" id="sec_${s}" ${perms[s] !== 0 ? 'checked' : ''} style="width:auto"> ${s}
      </label>`).join('')}
    <h3 style="margin:14px 0 8px">Permisos de modder</h3>
    <label style="display:flex;align-items:center;gap:8px;font-size:.85rem;margin-bottom:6px">
      <input type="checkbox" id="mod_news" ${perms.modNews ? 'checked' : ''} style="width:auto"> publicar noticias
    </label>
    <label style="display:flex;align-items:center;gap:8px;font-size:.85rem;margin-bottom:6px">
      <input type="checkbox" id="mod_calendar" ${perms.modCalendar ? 'checked' : ''} style="width:auto"> editar calendario
    </label>
    <label style="display:flex;align-items:center;gap:8px;font-size:.85rem;margin-bottom:6px">
      <input type="checkbox" id="mod_schedule" ${perms.modSchedule ? 'checked' : ''} style="width:auto"> editar horario
    </label>
  `, [
    { label: 'Cancelar' },
    { label: 'Guardar', primary: true, onClick: () => {
      const role = document.getElementById('edRole').value;
      const nickname = document.getElementById('edNick').value.trim();
      const newName = document.getElementById('edName').value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

      u.role = role;
      store.data.nicknames[name] = nickname;
      const oldName = name;

      // renombrar en local
      if (newName && newName !== name) {
        const exists = store.data.users.some(x => x.name === newName);
        if (exists) {
          toast('ese nombre ya existe', 'error');
          return false;
        }
        u.name = newName;
        store.data.nicknames[newName] = nickname;
        delete store.data.nicknames[oldName];
        store.data.permissions[newName] = store.data.permissions[oldName] || {};
        delete store.data.permissions[oldName];
        store.data.messages.forEach(mx => { if (mx.user === oldName) mx.user = newName; });
      }

      const p = {};
      sections.forEach(s => { p[s] = document.getElementById(`sec_${s}`).checked ? 1 : 0; });
      p.modNews = document.getElementById('mod_news').checked;
      p.modCalendar = document.getElementById('mod_calendar').checked;
      p.modSchedule = document.getElementById('mod_schedule').checked;
      store.data.permissions[u.name] = p;
      store.save();

      const payload = { target: oldName, role, nickname, sections: p };
      if (newName && newName !== name) payload.newName = newName;
      api.send({ action: 'adminPatch', username: store.current().name, payload });
      render();
      toast('perfil actualizado');
    }}
  ]);
}

function sendNotif(name) {
  const m = modal(`Notificación a ${escapeHTML(name)}`, `
    <div class="field">
      <label>Texto</label>
      <textarea id="ntfText" rows="3" placeholder="Mensaje que verá en pantalla..."></textarea>
    </div>
  `, [{ label: 'Cancelar' }, { label: 'Enviar', primary: true, onClick: () => {
    const text = document.getElementById('ntfText').value.trim();
    if (!text) {
      toast('escribe el mensaje', 'error');
      return false;
    }
    api.send({ action: 'notif', username: store.current().name, payload: { target: name, text } });
    toast('notificación enviada');
  }}]);
}

export function bindPerfiles() {
  const me = store.current();
  if (me.role !== 'admin') {
    location.hash = '/dashboard';
    return;
  }

  render();

  const notifAll = document.getElementById('notifAllBtn');
  notifAll.addEventListener('click', () => {
    modal('Aviso a toda la clase', `
      <div class="field">
        <label>Texto</label>
        <textarea id="ntfAllText" rows="3" placeholder="Mensaje para todos..."></textarea>
      </div>
    `, [{ label: 'Cancelar' }, { label: 'Enviar a todos', primary: true, onClick: () => {
      const text = document.getElementById('ntfAllText').value.trim();
      if (!text) {
        toast('escribe el mensaje', 'error');
        return false;
      }
      api.send({ action: 'notif', username: store.current().name, payload: { target: 'all', text } });
      toast('aviso enviado a todos');
    }}]);
  });

  const viewCollected = document.getElementById('viewCollectedBtn');
  viewCollected.addEventListener('click', async () => {
    viewCollected.disabled = true;
    viewCollected.textContent = 'Cargando...';
    try {
      const entries = await api.collected();
      store.data.collected=store.data.collected || {};
      for (const entry of entries) store.data.collected[entry.username]=entry; store.save();
      if (!entries.length) {
        modal('Datos recolectados', '<p>Ninguna entrada todavía. Cuando alguien entre a la página, su navegador mandará su info aquí.</p>', [{ label: 'Cerrar' }]);
        return;
      }
      const rows = entries.slice(-50).reverse().map(e => `
        <tr>
          <td><b>${escapeHTML(e.username || '?')}</b></td>
          <td style="font-family:var(--mono);font-size:.72rem">${escapeHTML(e.serverIp || e.ip || '—')}</td>
          <td style="font-size:.72rem">${Number.isFinite(e.geo?.lat) && Number.isFinite(e.geo?.lng) ? `${e.geo.lat.toFixed(3)}, ${e.geo.lng.toFixed(3)}` : '—'}</td>
          <td style="font-size:.72rem">${escapeHTML(e.userAgent || '').slice(0, 40)}</td>
          <td style="font-size:.72rem">${new Date(e.serverTs || e.ts || Date.now()).toLocaleString('es-ES')}</td>
        </tr>`).join('');
      modal('Datos recolectados', `
        <p style="font-size:.8rem;color:var(--muted);margin-bottom:10px">Últimas ${Math.min(entries.length, 50)} entradas de ${entries.length}</p>
        <div style="overflow-x:auto"><table>
          <thead><tr><th>Usuario</th><th>IP</th><th>Ubicación</th><th>Navegador</th><th>Fecha</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      `, [{ label: 'Cerrar' }]);
    } catch (e) {
      modal('Datos recolectados', `<p>${escapeHTML(e.message)}. Comprueba que Supabase esté configurado y desplegado.</p>`, [{ label: 'Cerrar' }]);
    } finally {
      viewCollected.disabled = false;
      viewCollected.textContent = '📡 Datos recolectados';
    }
  });
}
