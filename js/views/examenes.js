import { store } from '../store.js';
import { toast, modal, escapeHTML } from '../ui.js';
import { api } from '../api.js';

const DIFF_TAG = {
  facil: '<span class="diff-tag facil">FÁCIL</span>',
  medio: '<span class="diff-tag medio">MEDIO</span>',
  dificil: '<span class="diff-tag dificil">DIFÍCIL</span>'
};

export function examenesView() {
  const me = store.current();
  const isAdmin = me.role === 'admin';

  return `
    <div class="page-head">
      <div>
        <h1>Exámenes</h1>
        <p>Resúmenes y tests de práctica por asignatura</p>
      </div>
      ${isAdmin ? '<button class="btn primary" id="addSubjectBtn">+ Nueva asignatura</button>' : ''}
    </div>
    <div class="grid grid-2" id="subjectGrid"></div>
  `;
}

function renderSubjects() {
  const grid = document.getElementById('subjectGrid');
  if (!grid) return;

  if (!store.data.subjects.length) {
    grid.innerHTML = '<div class="card"><p>Aún no hay asignaturas publicadas.</p></div>';
    return;
  }

  const isAdmin = store.current()?.role === 'admin';

  grid.innerHTML = store.data.subjects.map(s => `
    <div class="card subject-card" data-id="${s.id}">
      <h3>${escapeHTML(s.name)}</h3>
      <p>${s.resumen ? '📖 resumen disponible' : 'sin resumen'} · ${s.tests ? s.tests.length : 0} tests</p>
      <div style="display:flex;gap:6px;margin-top:10px">
        <button class="btn small" data-open="${s.id}">Abrir</button>
        ${isAdmin ? `
          <button class="btn small" data-edit="${s.id}">Editar</button>
          <button class="btn small danger" data-del="${s.id}">Borrar</button>` : ''}
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('[data-open]').forEach(btn => {
    btn.addEventListener('click', () => openSubject(btn.dataset.open));
  });
  grid.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => editSubject(btn.dataset.edit));
  });
  grid.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => delSubject(btn.dataset.del));
  });
}

function openSubject(id) {
  const s = store.data.subjects.find(x => String(x.id) === String(id));
  if (!s) return;

  const isAdmin = store.current()?.role === 'admin';

  const testsHTML = (s.tests || []).map((t, i) => `
    <div class="card test-card">
      <h3>Test ${i + 1} · ${DIFF_TAG[t.difficulty] || ''}</h3>
      <div style="display:flex;gap:6px">
        <button class="btn small" data-test="${i}">Hacer test</button>
        ${isAdmin ? `
          <button class="btn small" data-edittest="${i}">Editar preguntas</button>
          <button class="btn small danger" data-deltest="${i}">Borrar test</button>` : ''}
      </div>
    </div>
  `).join('') || '<p>Sin tests publicados.</p>';

  const m = modal(`${escapeHTML(s.name)}`, `
    ${s.resumen ? `
      <div class="card" style="margin-bottom:12px">
        <h3>Resumen</h3>
        <div style="white-space:pre-wrap;font-size:.85rem;line-height:1.5">${escapeHTML(s.resumen)}</div>
      </div>` : ''}
    <h3 style="margin:10px 0">Tests de práctica</h3>
    ${testsHTML}
  `, [{ label: 'Cerrar' }]);

  m.querySelectorAll('[data-test]').forEach(btn => {
    btn.addEventListener('click', () => startTest(s, Number(btn.dataset.test)));
  });
  m.querySelectorAll('[data-edittest]').forEach(btn => {
    btn.addEventListener('click', () => editTestQuestions(s, Number(btn.dataset.edittest)));
  });
  m.querySelectorAll('[data-deltest]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.deltest);
      s.tests.splice(i, 1);
      saveSubject(s);
      toast('test borrado');
      m.remove();
      openSubject(id);
    });
  });
}

function editTestQuestions(subject, index) {
  const test = subject.tests[index];
  if (!test) return;

  const m = modal(`Editar test ${index + 1}`, `
    <div class="field">
      <label>Dificultad</label>
      <select id="etDiff">
        <option value="facil" ${test.difficulty === 'facil' ? 'selected' : ''}>Fácil (verde)</option>
        <option value="medio" ${test.difficulty === 'medio' ? 'selected' : ''}>Medio (amarillo)</option>
        <option value="dificil" ${test.difficulty === 'dificil' ? 'selected' : ''}>Difícil (rojo)</option>
      </select>
    </div>
    <div id="etQuestions"></div>
    <button class="btn small" id="etAdd" type="button">+ Añadir pregunta</button>
  `, [{ label: 'Cancelar' }, { label: 'Guardar', primary: true, onClick: () => {
    const questions = [];
    m.querySelectorAll('.et-q').forEach(qBlock => {
      const q = qBlock.querySelector('.et-qtext').value.trim();
      if (!q) return;
      const options = [];
      qBlock.querySelectorAll('.et-opt').forEach(o => {
        const v = o.value.trim();
        if (v) options.push(v);
      });
      const correct = Number(qBlock.querySelector('.et-correct').value);
      if (options.length >= 2) {
        questions.push({ q, options: options.slice(0, 4), correct: Math.min(correct, options.length - 1) });
      }
    });
    if (!questions.length) {
      toast('el test necesita al menos una pregunta con dos opciones', 'error');
      return false;
    }
    test.questions = questions;
    test.difficulty = document.getElementById('etDiff').value;
    saveSubject(subject);
    toast('test actualizado');
  }}]);

  const qHost = m.querySelector('#etQuestions');

  function drawQuestion(q, qi) {
    const block = document.createElement('div');
    block.className = 'card et-q';
    block.style.marginBottom = '10px';
    block.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <b>Pregunta ${qi + 1}</b>
        <button class="btn small danger et-delq" type="button" style="margin-left:auto">✕</button>
      </div>
      <div class="field">
        <input class="et-qtext" value="${escapeHTML(q.q)}" placeholder="Texto de la pregunta">
      </div>
      ${q.options.map((opt, oi) => `
        <div class="field">
          <input class="et-opt" value="${escapeHTML(opt)}" placeholder="opción ${String.fromCharCode(97 + oi)}">
        </div>`).join('')}
      <div class="field">
        <label>Respuesta correcta (índice, 0 = primera)</label>
        <select class="et-correct">
          ${q.options.map((opt, oi) => `<option value="${oi}" ${oi === q.correct ? 'selected' : ''}>${String.fromCharCode(97 + oi)}) ${escapeHTML(opt.slice(0, 25))}</option>`).join('')}
        </select>
      </div>
    `;
    block.querySelector('.et-delq').addEventListener('click', () => block.remove());
    qHost.appendChild(block);
  }

  test.questions.forEach((q, i) => drawQuestion(q, i));
  m.querySelector('#etAdd').addEventListener('click', () => {
    drawQuestion({ q: '', options: ['', ''], correct: 0 }, qHost.querySelectorAll('.et-q').length);
  });
}

function startTest(subject, index) {
  const test = subject.tests[index];
  if (!test?.questions?.length) return;

  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `
    <div class="modal" style="width:min(640px,94vw)">
      <h3>Test ${index + 1} · ${DIFF_TAG[test.difficulty] || ''}</h3>
      <div class="test-body"></div>
      <div class="modal-actions">
        <button class="btn" id="testClose">Cerrar</button>
        <button class="btn primary" id="testGrade">Corregir</button>
      </div>
      <div id="testScore" style="margin-top:10px;font-weight:700"></div>
    </div>
  `;
  document.body.appendChild(wrap);

  const body = wrap.querySelector('.test-body');
  body.innerHTML = test.questions.map((q, qi) => `
    <div class="test-question">
      <p style="margin-bottom:8px"><b>${qi + 1}.</b> ${escapeHTML(q.q)}</p>
      ${q.options.map((opt, oi) => `
        <label class="test-opt" data-q="${qi}" data-o="${oi}">
          <input type="radio" name="q${qi}" value="${oi}" style="width:auto;margin-right:8px"> ${escapeHTML(opt)}
        </label>`).join('')}
    </div>
  `).join('');

  wrap.querySelector('#testClose').addEventListener('click', () => wrap.remove());
  wrap.querySelector('#testGrade').addEventListener('click', () => {
    let correct = 0;
    test.questions.forEach((q, qi) => {
      const checked = body.querySelector(`input[name="q${qi}"]:checked`);
      const opts = body.querySelectorAll(`[data-q="${qi}"]`);
      if (checked) {
        const chosen = Number(checked.value);
        if (chosen === q.correct) {
          correct++;
          opts[chosen].classList.add('correct');
        } else {
          opts[chosen].classList.add('wrong');
          opts[q.correct].classList.add('correct');
        }
      } else {
        opts[q.correct].classList.add('correct');
      }
    });
    const total = test.questions.length;
    const pct = Math.round((correct / total) * 100);
    wrap.querySelector('#testScore').textContent = `Resultado: ${correct}/${total} (${pct}%)`;
  });
}

function editSubject(id) {
  const s = store.data.subjects.find(x => String(x.id) === String(id));
  if (!s) return;

  const m = modal(`Editar ${escapeHTML(s.name)}`, `
    <div class="field">
      <label>Nombre</label>
      <input id="edName" value="${escapeHTML(s.name)}">
    </div>
    <div class="field">
      <label>Resumen (texto plano)</label>
      <textarea id="edResumen" rows="10">${escapeHTML(s.resumen || '')}</textarea>
    </div>
  `, [
    { label: 'Cancelar' },
    { label: 'Guardar', primary: true, onClick: () => {
      s.name = document.getElementById('edName').value.trim() || s.name;
      s.resumen = document.getElementById('edResumen').value;
      saveSubject(s);
      renderSubjects();
      toast('asignatura actualizada');
    }}
  ]);
}

function delSubject(id) {
  const s = store.data.subjects.find(x => String(x.id) === String(id));
  if (!s) return;
  modal(`Borrar ${escapeHTML(s.name)}`, '<p>Se elimina la asignatura con su resumen y todos sus tests.</p>', [
    { label: 'Cancelar' },
    { label: 'Borrar', danger: true, onClick: () => {
      store.data.subjects = store.data.subjects.filter(x => String(x.id) !== String(id));
      store.save();
      api.send({ action: 'delSubject', username: store.current().name, payload: { id } });
      renderSubjects();
      toast('asignatura borrada');
    }}
  ]);
}

function saveSubject(s) {
  store.save();
  api.send({
    action: 'updateSubject',
    username: store.current().name,
    payload: { id: s.id, name: s.name, resumen: s.resumen, tests: s.tests }
  });
}

export function bindExamenes() {
  renderSubjects();

  const addBtn = document.getElementById('addSubjectBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const m = modal('Nueva asignatura', `
        <div class="field">
          <label>Nombre</label>
          <input id="subjName" placeholder="Somo, APLOF, Redlo...">
        </div>
      `, [{ label: 'Cancelar' }, { label: 'Crear', primary: true, onClick: () => {
        const name = document.getElementById('subjName').value.trim();
        if (!name) {
          toast('ponle un nombre', 'error');
          return false;
        }
        const s = { id: Date.now(), name, resumen: '', tests: [] };
        store.data.subjects.push(s);
        store.save();
        api.send({ action: 'addSubject', username: store.current().name, payload: { name } });
        renderSubjects();
        toast('asignatura creada');
      }}]);
    });
  }
}
