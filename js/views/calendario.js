import { store } from '../store.js';
import { toast, modal, escapeHTML } from '../ui.js';
import { api } from '../api.js';

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

let viewDate = new Date();

export function calendarioView() {
  const me = store.current();
  const canAdd = me.role === 'admin' || (me.role === 'modder' && (store.data.permissions[me.name] || {}).modCalendar);

  return `
    <div class="page-head">
      <div>
        <h1>Calendario</h1>
        <p>Exámenes, entregas y eventos de la clase</p>
      </div>
      ${canAdd ? '<button class="btn primary" id="addEventBtn">+ Añadir evento</button>' : ''}
    </div>
    <div class="card">
      <div class="cal-nav">
        <button class="btn small" id="calPrev">←</button>
        <h2 id="calTitle"></h2>
        <button class="btn small" id="calNext">→</button>
      </div>
      <div class="cal-grid" id="calGrid"></div>
    </div>
  `;
}

function renderCal() {
  const title = document.getElementById('calTitle');
  const grid = document.getElementById('calGrid');
  if (!title || !grid) return;

  title.textContent = `${MONTHS[viewDate.getMonth()]} ${viewDate.getFullYear()}`;

  const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  let startOffset = (first.getDay() + 6) % 7; // lunes primero
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();

  let html = DAYS.map(d => `<div class="cal-day-head">${d}</div>`).join('');
  for (let i = 0; i < startOffset; i++) html += '<div></div>';

  const today = new Date();
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const events = store.data.events.filter(e => e.date === dateStr);
    const isToday = today.getFullYear() === viewDate.getFullYear() &&
      today.getMonth() === viewDate.getMonth() && today.getDate() === d;
    const isAdmin = store.current()?.role === 'admin';
    html += `
      <div class="cal-day ${isToday ? 'today' : ''}">
        <div class="cal-day-head">${d}</div>
        ${events.map(e => `
          <div class="cal-event">
            ${escapeHTML(e.title)}
            ${isAdmin ? `<button class="btn small danger" data-evdel="${e.id}" style="padding:1px 5px;font-size:.65rem;margin-left:4px">✕</button>` : ''}
          </div>`).join('')}
      </div>`;
  }

  grid.innerHTML = html;

  grid.querySelectorAll('[data-evdel]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.evdel;
      store.data.events = store.data.events.filter(ev => String(ev.id) !== String(id));
      store.save();
      api.send({ action: 'delEvent', username: store.current().name, payload: { id } });
      renderCal();
    });
  });
}

export function bindCalendario() {
  renderCal();

  document.getElementById('calPrev').addEventListener('click', () => {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
    renderCal();
  });

  document.getElementById('calNext').addEventListener('click', () => {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
    renderCal();
  });

  const addBtn = document.getElementById('addEventBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const m = modal('Añadir evento', `
        <div class="field">
          <label>Título</label>
          <input id="evTitle" placeholder="Examen de matemáticas">
        </div>
        <div class="field">
          <label>Fecha</label>
          <input id="evDate" type="date">
        </div>
      `, [{ label: 'Cancelar' }, { label: 'Añadir', primary: true, onClick: () => {
        const title = document.getElementById('evTitle').value.trim();
        const date = document.getElementById('evDate').value;
        if (!title || !date) {
          toast('rellena título y fecha', 'error');
          return false;
        }
        store.data.events.push({ id: Date.now(), title, date, by: store.data.session });
        store.save();
        api.send({ action: 'addEvent', username: store.current().name, payload: { title, date } });
        renderCal();
        toast('evento añadido');
      }}]);
    });
  }
}
