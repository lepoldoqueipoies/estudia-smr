import { store } from '../store.js';
import { api } from '../api.js';
import { escapeHTML } from '../ui.js';

export function dashboardView() {
  const me = store.current();
  const totalUsers = store.data.users.length;
  const totalSubjects = store.data.subjects.length;
  const totalNews = store.data.news.length;
  const totalEvents = store.data.events.length;

  return `
    <div class="page-head">
      <div>
        <h1>Inicio</h1>
        <p>Bienvenido, ${escapeHTML(me.name)}</p>
      </div>
    </div>
    <div class="grid grid-4">
      <div class="card stat">
        <div class="stat-label">Estudiantes</div>
        <div class="stat-value">${totalUsers}</div>
        <div class="stat-delta">registrados en este dispositivo</div>
      </div>
      <div class="card stat">
        <div class="stat-label">Asignaturas</div>
        <div class="stat-value">${totalSubjects}</div>
        <div class="stat-delta">con contenido publicado</div>
      </div>
      <div class="card stat">
        <div class="stat-label">Noticias</div>
        <div class="stat-value">${totalNews}</div>
        <div class="stat-delta">publicadas</div>
      </div>
      <div class="card stat">
        <div class="stat-label">Eventos</div>
        <div class="stat-value">${totalEvents}</div>
        <div class="stat-delta">en el calendario</div>
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:14px">
      <div class="card">
        <h3>Próximos eventos</h3>
        <div id="dashEvents"></div>
      </div>
      <div class="card">
        <h3>Últimas noticias</h3>
        <div id="dashNews"></div>
      </div>
    </div>
  `;
}

export async function bindDashboard() {
  await api.syncAll();

  const today=new Date(); today.setHours(0,0,0,0);
  const events = [...store.data.events].filter(e=>new Date(e.date+'T00:00:00')>=today).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,5);
  const evHost = document.getElementById('dashEvents');
  if (!evHost) return;
  evHost.innerHTML = events.length
    ? events.map(e => `<p>📅 ${escapeHTML(e.title)} - <span style="color:var(--muted)">${escapeHTML(e.date)}</span></p>`).join('')
    : '<p>Sin eventos próximos.</p>';

  const news = [...store.data.news].sort((a,b)=>b.ts-a.ts).slice(0, 5);
  const nwHost = document.getElementById('dashNews');
  nwHost.innerHTML = news.length
    ? news.map(n => `<p>📰 ${escapeHTML(n.title)}</p>`).join('')
    : '<p>Sin noticias todavía.</p>';
}
