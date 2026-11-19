import { store } from '../store.js';
import { toast, modal, escapeHTML } from '../ui.js';
import { api } from '../api.js';
import { geminiTextStream } from '../stream.js';
import { extractOfficeText } from '../zip.js';
import { FUNCTIONS_URL, SUPABASE_ANON_KEY } from '../config.js';

const CHAT_PERSONA = `Eres la IA de ayuda de una plataforma de estudios para una clase. Hablas español, cercano y claro. Responde lo que te pregunten de forma directa y útil. Si te piden un resumen o ejercicios tipo test de un tema, o te adjuntan apuntes, genera el resumen detallado y las preguntas en el formato que te indiquen. Para una conversación normal, responde normal y corto.`;

const GEN_PROMPT = `Eres un profesor. Con este material, genera:
1. Un apartado que empiece con "RESUMEN:" seguido de un resumen bien explicado y detallado del tema, con esquemas en texto.
2. Después, 10 preguntas tipo test. Cada una en el formato:
1. pregunta
a) opción
b) opción
c) opción
d) opción
Correcta: a

`;

// ---------- sesiones de chat (persistidas en el store) ----------
let activeChatId = null;

function chats() {
  if (!Array.isArray(store.data.iaChats)) store.data.iaChats = [];
  return store.data.iaChats;
}
function activeChat() {
  return chats().find(c => c.id === activeChatId) || null;
}
function saveChats() { store.save(); }
function newChat() {
  const c = { id: Date.now() + Math.random(), name: 'Nueva conversación', messages: [], ts: Date.now() };
  chats().unshift(c);
  activeChatId = c.id;
  saveChats();
  return c;
}

export function iaView() {
  return `
    <div class="page-head">
      <div>
        <h1>IA</h1>
        <p>Chatea, pregunta dudas y genera resúmenes y tests con tus apuntes</p>
      </div>
    </div>
    <div class="card">
      <div class="ia-chatbar">
        <button class="btn small primary" id="newChatBtn">＋ Nuevo</button>
        <div class="ia-chats-wrap">
          <button class="btn small" id="chatsBtn">💬 <span id="chatsLabel">Chats</span> ▾</button>
          <div class="ia-chats-panel" id="chatsPanel" style="display:none"></div>
        </div>
      </div>
      <div class="ia-log" id="iaLog">
        <div class="ia-bubble ai">Hola, soy la IA de la plataforma. Pregúntame lo que quieras. Si me adjuntas apuntes (PDF, DOCX, ODT, texto) o me pides un resumen con preguntas tipo test, te lo genero. Cada respuesta tiene sus botones de copiar y publicar debajo.</div>
      </div>
      <div class="ia-input-bar">
        <label class="btn" style="cursor:pointer">
          📎
          <input type="file" id="iaFile" accept=".pdf,.docx,.odt,.txt,.md,.csv,.json,image/*" multiple style="display:none">
        </label>
        <textarea id="iaInput" rows="2" placeholder="Escribe aquí..."></textarea>
        <button class="btn primary" id="iaSend">Enviar</button><button class="btn danger" id="iaStop" hidden>Detener</button>
      </div>
      <div id="iaFilesLabel" class="attachment-list" aria-live="polite"></div>
    </div>
  `;
}

async function* streamGemini(contents, _timeoutSecs, temperature, signal) {
  const temporaryFiles = [...new Set(contents.flatMap(item => (item.parts || []).map(part => part.storageFile?.fileId).filter(Boolean)))];
  try {
    const res = await fetch(`${FUNCTIONS_URL}/ai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'x-studia-session': store.data.adminToken || ''
      },
      body: JSON.stringify({contents, temperature}), signal
    });
    if (!res.ok) { const error = await res.json().catch(()=>({})); throw new Error(error.error || `Error de Gemini (${res.status})`); }
    yield* geminiTextStream(res);
    return res.headers.get('X-Gemini-Model') || 'Gemini';
  } finally {
    await Promise.allSettled(temporaryFiles.map(fileId => api.sendRequest({
      action: 'deleteFile', username: store.data.session, payload: { fileId }
    })));
  }
}

// los PDF van como inlineData (Gemini los lee nativamente), el resto como texto
// DOCX/ODT se descomprimen en el navegador y se envía su texto
const PDF_MAX = 15 * 1024 * 1024; // tamaño máximo por archivo de IA; el binario se carga a Storage
const OFFICE_EXT = /\.(docx|odt)$/i;

async function readFiles(files) {
  const parts = [];
  for (const f of files) {
    const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      if (f.size > PDF_MAX) {
        throw new Error(`${f.name}: el máximo por PDF es 15 MB`);
      }
      const fileId = await api.uploadFile(f);
      parts.push({ storageFile: { fileId, mimeType: 'application/pdf' } });
    } else if (f.type.startsWith('image/')) {
      if (f.size > PDF_MAX) throw new Error(`${f.name}: imagen demasiado grande`);
      const fileId = await api.uploadFile(f);
      parts.push({ storageFile: { fileId, mimeType: f.type } });
    } else if (OFFICE_EXT.test(f.name)) {
      try {
        const text = await extractOfficeText(f);
        parts.push({ text: `ARCHIVO: ${f.name}\n---\n${text.slice(0, 30000)}` });
      } catch (e) {
        throw new Error(`${f.name}: ${e.message}`);
      }
    } else {
      if (!/\.(txt|md|csv|json|html|xml)$/i.test(f.name) && !f.type.startsWith('text/')) throw new Error('Formato no compatible: '+f.name);
      const text = await f.text();
      if (!text.trim()) throw new Error('El archivo está vacío: '+f.name);
      parts.push({ text: `ARCHIVO: ${f.name}\n---\n${text.slice(0, 30000)}` });
    }
  }
  return parts;
}

// markdown mínimo (negrita, cursiva, código, listas) sobre HTML escapado
function mdToHtml(text) {
  return escapeHTML(text)
    .replace(/^###\s*(.+)$/gm, '<strong>$1</strong>')
    .replace(/^##\s*(.+)$/gm, '<strong>$1</strong>')
    .replace(/^#\s*(.+)$/gm, '<strong>$1</strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^(\d+)[.)]\s+/gm, '<strong>$1.</strong> ')
    .replace(/^([a-dA-D])[.)]\s+/gm, '<strong>$1)</strong> ')
    .replace(/\n/g, '<br>');
}

function parseGenerated(text) {
  const lines = text.split('\n').map(l => l.trim());

  // el resumen termina donde empieza la sección de preguntas, si la hay
  const marker = lines.findIndex(l => /preguntas?\s*(tipo\s*)?test/i.test(l));
  let firstQ;
  if (marker !== -1) {
    firstQ = lines.findIndex((l, i) => i > marker && /^\d+[.)]\s*.+/.test(l));
    if (firstQ === -1) firstQ = lines.length;
  } else {
    // sin marcador: una línea numerada solo es pregunta si tiene opciones detrás
    const cand = lines.findIndex(l => /^\d+[.)]\s*.+/.test(l));
    const hasOptions = i => lines.slice(i + 1, i + 6).some(l => /^[a-dA-D][.)]\s*.+/.test(l));
    firstQ = cand !== -1 && hasOptions(cand) ? cand : lines.length;
  }

  const resumenRaw = lines.slice(0, firstQ).join('\n');
  const resumen = resumenRaw.replace(/^RESUMEN:?\s*/i, '').trim();

  // agrupa líneas por pregunta
  const tests = [];
  let current = null;
  for (const l of lines.slice(firstQ)) {
    const qm = l.match(/^(\d+)[.)]\s*(.+)/);
    if (qm) {
      if (current) tests.push(current);
      current = { q: qm[2], options: [], correct: -1 };
      continue;
    }
    if (!current) continue;

    const om = l.match(/^([a-dA-D])[.)]\s*(.+)/);
    if (om) {
      const isMarked = l.startsWith('*') || /\*\s*$/.test(l) || /\(correcta\)|✓/i.test(l);
      current.options.push(om[2]);
      if (isMarked) current.correct = current.options.length - 1;
      continue;
    }

    const cm = l.match(/^correcta\s*:\s*([a-dA-D])/i);
    if (cm) {
      const letter = cm[1].toLowerCase().charCodeAt(0) - 97;
      if (letter >= 0 && letter < 4) current.correct = letter;
    }
  }
  if (current) tests.push(current);

  const clean = tests
    .filter(t => t.options.length >= 2)
    .map(t => ({
      q: t.q,
      options: t.options.slice(0, 4),
      correct: t.correct === -1 ? 0 : t.correct
    }));

  return { resumen: resumen || text.trim(), tests: clean };
}

export function bindIA() {
  let busy = false, controller;
  const stopBtn = document.getElementById('iaStop');
  stopBtn.addEventListener('click', () => controller?.abort());
  window.addEventListener('studia:navigate', () => controller?.abort(), {once:true});
  const log = document.getElementById('iaLog');
  const input = document.getElementById('iaInput');
  const sendBtn = document.getElementById('iaSend');
  const fileInput = document.getElementById('iaFile');
  const filesLabel = document.getElementById('iaFilesLabel');
  fileInput.addEventListener('change', () => { filesLabel.textContent = Array.from(fileInput.files || []).map(f => `${f.name} · ${(f.size/1024).toFixed(0)} KB`).join(' / '); });
  const newChatBtn = document.getElementById('newChatBtn');
  const chatsBtn = document.getElementById('chatsBtn');
  const chatsPanel = document.getElementById('chatsPanel');
  const chatsLabel = document.getElementById('chatsLabel');

  if (!chats().length) newChat();
  if (!activeChat()) activeChatId = chats()[0].id;

  function renderLog() {
    const chat = activeChat();
    log.innerHTML = '';
    if (!chat || !chat.messages.length) {
      const w = document.createElement('div');
      w.className = 'ia-bubble ai';
      w.textContent = 'Hola, soy la IA de la plataforma. Pregúntame lo que quieras. Si me adjuntas apuntes (PDF, DOCX, ODT, texto) o me pides un resumen con preguntas tipo test, te lo genero. Cada respuesta tiene sus botones de copiar y publicar debajo.';
      log.appendChild(w);
      return;
    }
    chat.messages.forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'ia-row ' + (m.role === 'ai' ? 'ai' : 'user');
      row.dataset.idx = i;
      const b = document.createElement('div');
      b.className = 'ia-bubble ' + (m.role === 'ai' ? 'ai' : 'user');
      if (m.role === 'ai') b.innerHTML = mdToHtml(m.text);
      else b.textContent = m.text;
      if (m.role === 'ai' && m.model) {
        const meta = document.createElement('div');
        meta.className = 'ia-meta';
        meta.textContent = m.model + ' · ' + m.secs + ' s';
        b.appendChild(meta);
      }
      const act = document.createElement('div');
      act.className = 'ia-actions';
      if (m.role === 'ai') {
        act.innerHTML = '<button class="ia-action" data-act="copy">📋 Copiar</button>' +
                        '<button class="ia-action" data-act="pub">📢 Publicar</button>';
      } else {
        act.innerHTML = '<button class="ia-action" data-act="edit">✏️ Editar</button>';
      }
      b.appendChild(act);
      row.appendChild(b);
      log.appendChild(row);
    });
    log.scrollTop = log.scrollHeight;
  }

  function renderChatsUI() {
    const chat = activeChat();
    chatsLabel.textContent = chat ? (chat.name.length > 22 ? chat.name.slice(0, 22) + '…' : chat.name) : 'Chats';
    chatsPanel.innerHTML = '';
    for (const c of chats()) {
      const item = document.createElement('div');
      item.className = 'ia-chat-item' + (c.id === activeChatId ? ' active' : '');
      item.innerHTML = `<span class="ia-chat-name">${escapeHTML(c.name)}</span>
        <span style="font-size:.68rem;color:var(--muted)">${c.messages.length} msg</span>`;
      const rn = document.createElement('button');
      rn.className = 'ia-chat-act'; rn.textContent = '✏️'; rn.title = 'Renombrar';
      const del = document.createElement('button');
      del.className = 'ia-chat-act del'; del.textContent = '🗑'; del.title = 'Eliminar';
      item.appendChild(rn); item.appendChild(del);
      item.addEventListener('click', e => {
        if (e.target.closest('.ia-chat-act')) return;
        activeChatId = c.id;
        renderLog(); renderChatsUI();
        chatsPanel.style.display = 'none';
      });
      rn.addEventListener('click', () => renameChat(c.id));
      del.addEventListener('click', () => deleteChat(c.id));
      chatsPanel.appendChild(item);
    }
  }

  function renameChat(id) {
    const c = chats().find(x => x.id === id);
    if (!c) return;
    modal('Renombrar chat', `
      <div class="field">
        <label>Nombre</label>
        <input id="rnInput" value="${escapeHTML(c.name)}">
      </div>`, [
      { label: 'Cancelar' },
      { label: 'Guardar', primary: true, onClick: () => {
        const v = document.getElementById('rnInput').value.trim();
        if (!v) return false;
        c.name = v;
        saveChats();
        renderChatsUI();
      }}
    ]);
  }

  function deleteChat(id) {
    const c = chats().find(x => x.id === id);
    if (!c) return;
    modal('Eliminar chat', `<p style="color:var(--muted);font-size:.85rem">Se eliminará "<b>${escapeHTML(c.name)}</b>" con ${c.messages.length} mensajes.</p>`, [
      { label: 'Cancelar' },
      { label: 'Eliminar', primary: true, onClick: () => {
        store.data.iaChats = chats().filter(x => x.id !== id);
        if (activeChatId === id) {
          if (!chats().length) newChat();
          else activeChatId = chats()[0].id;
        }
        saveChats();
        renderLog(); renderChatsUI();
      }}
    ]);
  }

  async function buildContents(isGen, prompt, files) {
    const chat = activeChat();
    if (isGen) {
      const parts = [{ text: GEN_PROMPT + '\nMaterial o petición del alumno:\n' + (prompt || 'Genera el resumen y los tests del material adjunto.') }];
      parts.push(...await readFiles(files));
      return [{ role: 'user', parts }];
    }
    const contents = [];
    if (!chat || chat.messages.length < 2) {
      contents.push(
        { role: 'user', parts: [{ text: CHAT_PERSONA }] },
        { role: 'model', parts: [{ text: 'Entendido. Pregúntame lo que quieras.' }] }
      );
    }
    if (chat) {
      contents.push(...chat.messages.slice(0,-1).slice(-20).map(m => ({
        role: m.role === 'ai' ? 'model' : 'user',
        parts: [{ text: m.text }]
      })));
    }
    contents.push({ role: 'user', parts: [{ text: prompt }] });
    return contents;
  }

  async function runStream(contents, timeoutSecs, temperature) {
    // burbuja de pensamiento con puntos animados y cronómetro
    const bubble = document.createElement('div');
    bubble.className = 'ia-bubble ai thinking';
    const dots = [];
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('span');
      d.className = 'ia-dot';
      dots.push(d);
      bubble.appendChild(d);
    }
    const label = document.createElement('span');
    bubble.appendChild(label);
    log.appendChild(bubble);
    log.scrollTop = log.scrollHeight;

    const t0 = performance.now();
    const tick = () => { label.textContent = `Pensando… ${((performance.now() - t0) / 1000).toFixed(0)} s`; };
    tick();
    const timerId = setInterval(tick, 1000);

    let full = '';
    let model = '';
    try {
      const it = streamGemini(contents, timeoutSecs, temperature, controller?.signal);
      while (true) {
        const { value, done } = await it.next();
        if (done) { model = value || ''; break; }
        full += value;
        bubble.classList.remove('thinking');
        bubble.innerHTML = mdToHtml(full);
        log.scrollTop = log.scrollHeight;
      }
    } catch (e) {
      clearInterval(timerId);
      bubble.classList.remove('thinking');
      bubble.textContent = e.name === 'AbortError' ? 'Respuesta detenida.' : 'Error: ' + e.message;
      if (full) return {ok:true,text:full + '\n\n[Respuesta incompleta: '+ (e.name === 'AbortError' ? 'detenida por ti' : e.message) +']',secs:0,model:'Gemini'};
      return { ok: false, text: '', secs: 0 };
    } finally {
      clearInterval(timerId);
    }

    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    if (full) {
      const meta = document.createElement('div');
      meta.className = 'ia-meta';
      meta.textContent = `${model} · ${secs} s`;
      bubble.appendChild(meta);
    }
    return { ok: !!full, text: full, secs, model };
  }

  // silent: el mensaje de usuario ya está en el chat (edición) — no se añade
  async function sendInternal(prompt, files, silent) {
    const chat = activeChat();
    if (!chat) return;
    const isGen = files.length > 0 || /resumen|test|preguntas|examen|ejercicio|apuntes/i.test(prompt);

    if (!silent) {
      chat.messages.push({ role: 'user', text: prompt, ts: Date.now() });
      if (chat.name === 'Nueva conversación') chat.name = prompt.slice(0, 30);
      saveChats();
      renderLog();
      renderChatsUI();
    }

    const contents = await buildContents(isGen, prompt, files);
    const r = await runStream(contents, isGen ? 60 : 20, isGen ? 0.4 : 0.8);
    if (!r.ok) return;

    chat.messages.push({ role: 'ai', text: r.text, ts: Date.now(), model: r.model, secs: r.secs });
    saveChats();
    renderLog();
  }

  async function send() {
    if (busy) return;
    const prompt = input.value.trim();
    const files = Array.from(fileInput.files || []);
    if (!prompt && !files.length) return;
    busy = true; controller = new AbortController();
    sendBtn.disabled = true; fileInput.disabled = true; newChatBtn.disabled = true; chatsBtn.disabled = true; stopBtn.hidden = false;
    try {
      await sendInternal(prompt || 'Analiza los documentos adjuntos.', files, false);
      input.value = ''; fileInput.value = ''; filesLabel.textContent = '';
    } catch (error) { toast(error.message, 'error'); }
    finally { busy=false; sendBtn.disabled=false; fileInput.disabled=false; newChatBtn.disabled=false; chatsBtn.disabled=false; stopBtn.hidden=true; }
  }

  function editMessage(idx) {
    const chat = activeChat();
    const msg = chat.messages[idx];
    if (!msg || msg.role !== 'user') return;
    const row = log.querySelector(`.ia-row[data-idx="${idx}"]`);
    if (!row) return;
    row.innerHTML = `
      <textarea class="ia-edit" rows="3">${escapeHTML(msg.text)}</textarea>
      <div class="ia-actions">
        <button class="btn small primary" id="editSave">Guardar y reenviar</button>
        <button class="btn small" id="editCancel">Cancelar</button>
      </div>`;
    const ta = row.querySelector('.ia-edit');
    ta.focus();
    row.querySelector('#editSave').addEventListener('click', async () => {
      const t = ta.value.trim();
      if (!t) { toast('el mensaje está vacío', 'error'); return; }
      msg.text = t;
      // se corta la conversación desde el mensaje editado y se regenera la respuesta
      chat.messages = chat.messages.slice(0, idx + 1);
      saveChats();
      renderLog();
      await sendInternal(t, [], true);
    });
    row.querySelector('#editCancel').addEventListener('click', () => renderLog());
  }

  function publishMsg(idx) {
    const chat = activeChat();
    const msg = chat.messages[idx];
    if (!msg || msg.role !== 'ai') return;

    const subjects = store.data.subjects;
    if (!subjects.length) {
      toast('crea primero una asignatura en Exámenes', 'error');
      return;
    }

    const parsed = parseGenerated(msg.text);
    const hasTests = parsed.tests.length > 0;

    modal('Publicar respuesta', `
      <div class="field">
        <label style="display:flex;align-items:center;gap:7px;cursor:pointer">
          <input type="checkbox" id="pubRes" checked style="width:auto"> Publicar como resumen
        </label>
        <textarea id="pubResText" rows="6">${escapeHTML(parsed.resumen.slice(0, 20000))}</textarea>
      </div>
      <div class="field">
        <label style="display:flex;align-items:center;gap:7px;cursor:pointer">
          <input type="checkbox" id="pubTest" ${hasTests ? 'checked' : 'disabled'} style="width:auto">
          Publicar como tipo test (${hasTests ? parsed.tests.length + ' preguntas detectadas' : 'no se detectaron preguntas en esta respuesta'})
        </label>
        ${hasTests ? `
        <select id="pubDiff">
          <option class="facil" value="facil">Fácil (verde)</option>
          <option class="medio" value="medio">Medio (amarillo)</option>
          <option class="dificil" value="dificil">Difícil (rojo)</option>
        </select>` : ''}
      </div>
      <div class="field">
        <label>Asignatura</label>
        <select id="pubSubject">
          ${subjects.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join('')}
        </select>
      </div>
    `, [
      { label: 'Cancelar' },
      { label: 'Publicar', primary: true, onClick: () => {
        const subjectId = Number(document.getElementById('pubSubject').value);
        const subject = store.data.subjects.find(s => s.id === subjectId);
        if (!subject) return false;
        const wantRes = document.getElementById('pubRes').checked;
        const wantTest = hasTests && document.getElementById('pubTest').checked;
        if (!wantRes && !wantTest) {
          toast('marca al menos una opción', 'error');
          return false;
        }
        if (wantRes) {
          const text = document.getElementById('pubResText').value.trim();
          if (!text) { toast('el resumen está vacío', 'error'); return false; }
          subject.resumen = (subject.resumen ? subject.resumen + '\n\n' : '') + text;
        }
        if (wantTest) {
          subject.tests = subject.tests || [];
          subject.tests.push({
            difficulty: document.getElementById('pubDiff').value,
            questions: parsed.tests,
            ts: Date.now()
          });
        }
        store.save();
        api.send({
          action: 'updateSubject',
          username: store.current().name,
          payload: { id: subject.id, name: subject.name, resumen: subject.resumen, tests: subject.tests }
        });
        toast('publicado en ' + subject.name);
      }}
    ]);
  }

  log.addEventListener('click', e => {
    const btn = e.target.closest('.ia-action');
    if (!btn) return;
    const row = btn.closest('.ia-row');
    const idx = Number(row.dataset.idx);
    if (btn.dataset.act === 'copy') {
      const chat = activeChat();
      const msg = chat.messages[idx];
      if (!msg) return;
      navigator.clipboard.writeText(msg.text).then(
        () => toast('copiado'),
        () => toast('no se pudo copiar', 'error')
      );
    } else if (btn.dataset.act === 'pub') {
      publishMsg(idx);
    } else if (btn.dataset.act === 'edit') {
      editMessage(idx);
    }
  });

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  newChatBtn.addEventListener('click', () => {
    newChat();
    renderLog();
    renderChatsUI();
    chatsPanel.style.display = 'none';
  });

  chatsBtn.addEventListener('click', e => {
    e.stopPropagation();
    renderChatsUI();
    chatsPanel.style.display = chatsPanel.style.display === 'none' ? 'block' : 'none';
  });
  const closePanel = e => {
    if (chatsPanel.style.display !== 'none' && !e.target.closest('.ia-chats-wrap')) {
      chatsPanel.style.display = 'none';
    }
  };
  document.addEventListener('click', closePanel);
  window.addEventListener('studia:navigate', () => document.removeEventListener('click',closePanel), {once:true});

  renderLog();
  renderChatsUI();
}
