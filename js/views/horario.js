import { store } from '../store.js';
import { toast, modal, escapeHTML } from '../ui.js';
import { api } from '../api.js';

// lunes a viernes, 16:00 a 21:50, recreo 18:45-19:00
const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
const START = 16 * 60;       // 16:00
const END = 21 * 60 + 50;    // 21:50
const BREAK_START = 18 * 60 + 45; // 18:45
const BREAK_END = 19 * 60;        // 19:00

function slotTimes() {
  const slots = [];
  let t = START;
  while (t < END) {
    const end=Math.min(t+50,END);
    const cuts=[t,...[BREAK_START,BREAK_END].filter(v=>v>t && v<end),end];
    for (let i=0;i<cuts.length-1;i++) slots.push({start:cuts[i],end:cuts[i+1]});
    t += 50;
  }
  return slots;
}

export function horarioView() {
  const me = store.current();
  const canEdit = me.role === 'admin' || (me.role === 'modder' && (store.data.permissions[me.name] || {}).modSchedule);

  return `
    <div class="page-head">
      <div>
        <h1>Horario</h1>
        <p>De lunes a viernes · 16:00 a 21:50 · recreo 18:45 - 19:00</p>
      </div>
    </div>
    <div class="card" style="overflow-x:auto">
      <div class="sched-grid" id="schedGrid"></div>
    </div>
    ${canEdit ? '<p style="margin-top:10px;font-size:.78rem;color:var(--muted)">Haz clic en un hueco para rellenarlo o borrarlo.</p>' : ''}
  `;
}

function slotLabel(day, start, end) {
  const found = store.data.schedule.find(s =>
    s.day === day && s.start <= start && s.end >= end);
  return found ? found.label : null;
}

function fmtHM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function render() {
  const grid = document.getElementById('schedGrid');
  if (!grid) return;

  const slots = slotTimes();
  let html = '<div></div>' + DAYS.map(d => `<div class="sched-day-head">${d}</div>`).join('');

  for (const slot of slots) {
    // recreo: la franja que solapa 18:45-19:00
    const isBreak = slot.start < BREAK_END && slot.end > BREAK_START;
    html += `<div class="sched-time">${fmtHM(slot.start)}</div>`;
    for (let d = 0; d < 5; d++) {
      const label = slotLabel(d, fmtHM(slot.start), fmtHM(slot.end));
      html += `
        <div class="sched-slot ${label ? 'filled' : ''} ${isBreak ? 'break' : ''}"
             data-day="${d}" data-start="${fmtHM(slot.start)}" data-end="${fmtHM(slot.end)}"
             title="${isBreak ? 'RECREO' : escapeHTML(label || 'hueco libre')}">
          ${isBreak ? '☕ recreo' : escapeHTML(label || '')}
        </div>`;
    }
  }

  grid.innerHTML = html;
}

export function bindHorario() {
  render();

  const me = store.current();
  const canEdit = me.role === 'admin' || (me.role === 'modder' && (store.data.permissions[me.name] || {}).modSchedule);
  if (!canEdit) return;

  document.getElementById('schedGrid').addEventListener('click', event => {
      const slot=event.target.closest('.sched-slot');
      if (!slot) return;
      const day = Number(slot.dataset.day);
      const start = slot.dataset.start;
      const end = slot.dataset.end;

      if (slot.classList.contains('break')) {
        toast('ese hueco es el recreo', 'error');
        return;
      }

      const existing = store.data.schedule.find(s =>
        s.day === day && s.start === start && s.end === end);

      const m = modal(`Horario · ${DAYS[day]} ${start}-${end}`, `
        <div class="field">
          <label>Asignatura o actividad (vacío para borrar)</label>
          <input id="slotLabel" value="${escapeHTML(existing ? existing.label : '')}">
        </div>
      `, [{ label: 'Cancelar' }, { label: 'Guardar', primary: true, onClick: () => {
        const label = document.getElementById('slotLabel').value.trim();
        store.data.schedule = store.data.schedule.filter(s =>
          !(s.day === day && s.start === start && s.end === end));
        if (label) {
          store.data.schedule.push({ day, start, end, label });
        }
        store.save();
        api.send({ action: 'setSchedule', username: store.current().name, payload: { schedule: store.data.schedule } });
        render();
        toast(label ? 'hueco rellenado' : 'hueco vaciado');
      }}]);
  });
}
