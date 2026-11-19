import { store } from '../store.js';
import { toast, modal, escapeHTML, fmtDate } from '../ui.js';
import { api } from '../api.js';

export function noticiasView() {
  const me = store.current();
  const canPost = me.role === 'admin' || (me.role === 'modder' && (store.data.permissions[me.name] || {}).modNews);

  return `
    <div class="page-head">
      <div>
        <h1>Noticias</h1>
        <p>Lo que pasa en la clase</p>
      </div>
      ${canPost ? '<button class="btn primary" id="addNewsBtn">+ Publicar noticia</button>' : ''}
    </div>
    <div id="newsList"></div>
  `;
}

function render() {
  const host = document.getElementById('newsList');
  if (!host) return;

  const isAdmin = store.current()?.role === 'admin';
  const news = [...store.data.news].sort((a, b) => b.ts - a.ts);
  host.innerHTML = news.length
    ? news.map(n => `
      <div class="card news-item">
        <h3>${escapeHTML(n.title)}</h3>
        <div class="news-body">${escapeHTML(n.body)}</div>
        <div class="news-meta">por ${escapeHTML(n.author)} · ${fmtDate(n.ts)}
          ${isAdmin ? `<button class="btn small danger" data-nwdel="${n.id}" style="margin-left:8px">✕</button>` : ''}
        </div>
      </div>`).join('')
    : '<div class="card"><p>No hay noticias todavía.</p></div>';

  host.querySelectorAll('[data-nwdel]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.nwdel;
      store.data.news = store.data.news.filter(n => String(n.id) !== String(id));
      store.save();
      api.send({ action: 'delNews', username: store.current().name, payload: { id } });
      render();
    });
  });
}

export function bindNoticias() {
  render();

  const btn = document.getElementById('addNewsBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      const m = modal('Publicar noticia', `
        <div class="field">
          <label>Título</label>
          <input id="nwTitle" placeholder="Aviso importante">
        </div>
        <div class="field">
          <label>Contenido</label>
          <textarea id="nwBody" rows="5" placeholder="Escribe la noticia..."></textarea>
        </div>
      `, [{ label: 'Cancelar' }, { label: 'Publicar', primary: true, onClick: () => {
        const title = document.getElementById('nwTitle').value.trim();
        const body = document.getElementById('nwBody').value.trim();
        if (!title || !body) {
          toast('título y contenido son obligatorios', 'error');
          return false;
        }
        store.data.news.push({
          id: Date.now(), title, body,
          author: store.data.session, ts: Date.now()
        });
        store.save();
        api.send({ action: 'addNews', username: store.current().name, payload: { title, body } });
        render();
        toast('noticia publicada');
      }}]);
    });
  }
}
