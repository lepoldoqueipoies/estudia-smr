import { store } from './store.js';
import { api } from './api.js';
import { escapeHTML } from './ui.js';

// ruta -> clave de permiso de sección
const ROUTE_SECTION = {
  '/chat': 'chat',
  '/calendario': 'calendar',
  '/examenes': 'exams',
  '/horario': 'schedule',
  '/noticias': 'news'
};

export function router(routes) {
  const app = document.getElementById('app');

  async function render() {
    window.dispatchEvent(new Event('studia:navigate'));
    const hash = location.hash.slice(1) || '/login';

    if (!store.data.session && hash !== '/login') {
      location.hash = '/login';
      return;
    }

    if (store.data.session && hash === '/login') {
      location.hash = '/dashboard';
      return;
    }

    // bloqueo de secciones por admin
    if (store.data.session) {
      const me = store.current();
      if (['/ia','/perfiles'].includes(hash) && me?.role !== 'admin') { location.hash = '/dashboard'; return; }
      const section = ROUTE_SECTION[hash];
      if (section) {
        const perms = store.data.permissions[me.name] || {};
        if (perms[section] === 0) {
          app.innerHTML = `
            <div class="login-wrap"><div class="login-card">
              <h1>Sección bloqueada</h1>
              <p class="login-sub">El admin te quitó el acceso a esta sección.</p>
              <a class="btn primary" href="#/dashboard" data-link>Volver al inicio</a>
            </div></div>`;
          return;
        }
      }
    }

    const route = routes[hash] || routes['/dashboard'] || routes['/login'];
    const html = route ? await route() : '<p>404</p>';
    app.innerHTML = html;

    if (store.data.session) {
      bindLogout();
      // notificaciones del admin visibles en cualquier sección, una sola vez
      const me = store.current();
      store.data.notifs.forEach(n => {
        if (n.id == null) n.id = 'local_' + Math.random();
      });
      const seen = store.data.seenNotifs[me.name] || [];
      const mine = store.data.notifs.filter(n =>
        (n.target === me.name || n.target === 'all') && !seen.includes(String(n.id)));
      if (mine.length) {
        mine.slice(0, 3).forEach(n => {
          const banner = document.createElement('div');
          banner.className = 'notif-banner';
          banner.textContent = `🔔 ${n.text}`;
          document.body.appendChild(banner);
          setTimeout(() => banner.remove(), 5000);
        });
        api.ackNotifs(mine.map(n => n.id));
      }
    }

    app.querySelectorAll('[data-link]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        location.hash = a.getAttribute('href');
      });
    });
  }

  window.addEventListener('hashchange', render);
  render();
}

export function shell(contentHTML, activeRoute) {
  const me = store.current();
  const role = me?.role || 'user';
  const perms = store.data.permissions[me.name] || {};

  const allItems = [
    ['/dashboard', '📊', 'Inicio', null],
    ['/chat', '💬', 'Chat', 'chat'],
    ['/calendario', '📅', 'Calendario', 'calendar'],
    ['/examenes', '📚', 'Exámenes', 'exams'],
    ['/horario', '🕒', 'Horario', 'schedule'],
    ['/noticias', '📰', 'Noticias', 'news'],
    ['/perfil', '👤', 'Perfil', null]
  ];
  if (role === 'admin') {
    allItems.push(['/perfiles', '🛡️', 'Perfiles', null], ['/ia', '🤖', 'IA', null]);
  }

  const navItems = allItems.filter(([, , , section]) =>
    !section || perms[section] !== 0);

  const nav = navItems
    .map(([href, icon, label]) => `
      <a href="${href}" data-link class="${href === activeRoute ? 'active' : ''}">
        <span class="nav-icon">${icon}</span>${label}
      </a>`)
    .join('');

  const av = store.avatar(me.name);
  const avatarInner = av
    ? `<img src="${av}" alt="">`
    : me.name.charAt(0).toUpperCase();
  const roleClass = role === 'admin' ? 'admin' : role === 'modder' ? 'modder' : 'user';

  return `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">N</div>
          <span class="brand-name">Plataforma de Estudios</span>
        </div>
        <nav class="nav">${nav}</nav>
        <div class="sidebar-foot">
          <div class="sidebar-avatar">${avatarInner}</div>
          <div class="sidebar-user">
            <div class="sidebar-name">${escapeHTML(me.name)}</div>
            <div class="sidebar-role badge ${roleClass}">${role}</div>
          </div>
          <button class="sidebar-logout" id="logoutBtn" title="Salir">⏻</button>
        </div>
      </aside>
      <main class="main">${contentHTML}</main>
    </div>
  `;
}

export function bindLogout() {
  const btn = document.getElementById('logoutBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      store.data.session = null;
      store.data.adminToken = null;
      store.save();
      location.hash = '/login';
    });
  }
}
