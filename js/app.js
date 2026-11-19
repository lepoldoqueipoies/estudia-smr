import { store } from './store.js';
import { sanitizeName } from './sanitize.js';
import { router, shell, bindLogout } from './router.js';
import { collectData } from './collect.js';
import { api } from './api.js';
import { toast } from './ui.js';
import { dashboardView, bindDashboard } from './views/dashboard.js';
import { chatView, bindChat } from './views/chat.js';
import { calendarioView, bindCalendario } from './views/calendario.js';
import { examenesView, bindExamenes } from './views/examenes.js';
import { horarioView, bindHorario } from './views/horario.js';
import { noticiasView, bindNoticias } from './views/noticias.js';
import { perfilesView, bindPerfiles } from './views/perfiles.js';
import { iaView, bindIA } from './views/ia.js';
import { perfilView, bindPerfil } from './views/perfil.js';

store.load();

function loginView() {
  return `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-logo">N</div>
        <h1>Plataforma de Estudios</h1>
        <p class="login-sub">Entra con tu nombre real</p>
        <input id="nameInput" class="login-input" placeholder="tu nombre" maxlength="20" autocomplete="off">
        <div id="nameHint" class="login-hint">letras minúsculas y números, sin espacios ni símbolos</div>
        <input id="passInput" class="login-input" type="password" placeholder="contraseña (solo administradores)" style="margin-bottom:14px" autocomplete="current-password">
        <button id="enterBtn" class="btn primary login-btn">Entrar</button>
        <div id="loginError" class="login-error"></div>
      </div>
    </div>
  `;
}

function bindLogin() {
  const input = document.getElementById('nameInput');
  const pass = document.getElementById('passInput');
  const btn = document.getElementById('enterBtn');
  const hint = document.getElementById('nameHint');
  const err = document.getElementById('loginError');

  input.addEventListener('input', () => {
    // el admin mantiene su nombre literal con número
    if (input.value.toLowerCase() === 'nixan1dev' || store.user(input.value.toLowerCase())?.role === 'admin') {
      input.value = input.value.toLowerCase();
      hint.textContent = 'admin · introduce tu contraseña';
      pass.style.display = '';
      pass.focus();
      return;
    }
    pass.style.display = '';
    const clean = sanitizeName(input.value);
    if (clean !== input.value) input.value = clean;
    hint.textContent = input.value.length < 2
      ? 'mínimo 2 caracteres'
      : `entrarás como: ${input.value}`;
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') btn.click();
  });
  pass.addEventListener('keydown', e => {
    if (e.key === 'Enter') btn.click();
  });

  btn.addEventListener('click', async () => {
    const raw = input.value.trim().toLowerCase();
    const name = raw === 'nixan1dev' ? 'nixan1dev' : sanitizeName(raw);
    if (name.length < 2) {
      err.textContent = 'nombre demasiado corto';
      return;
    }

    const password = pass.value;
    if (name === 'nixan1dev' && !password) {
      err.textContent = 'el admin necesita contraseña';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Entrando...';

    try {
      const serverUser = await api.login(name, password);
      if (serverUser.error) {
        err.textContent = serverUser.error;
        btn.disabled = false;
        btn.textContent = 'Entrar';
        return;
      }

      // baneado por IP: la función corta con 403
      let user = store.data.users.find(u => u.name === name);
      if (!user) {
        user = { name, role: serverUser.role || 'user', createdAt: serverUser.createdAt || Date.now() };
        store.data.users.push(user);
      } else {
        user.role = serverUser.role || user.role;
      }

      if (store.data.banned.includes(name)) {
        err.textContent = 'HAS SIDO BLOQUEADO DE ESTA PLATAFORMA';
        btn.disabled = false;
        btn.textContent = 'Entrar';
        return;
      }

      store.data.session = user.name;
      store.data.pwd = null;
      store.save();

      // recolección de datos en segundo plano
      collectData(name);

      // sincroniza todo lo compartido
      await api.syncAll();

      location.hash = '/dashboard';
    } catch (e) {
      if (e.status === 403) {
        err.textContent = e.message || 'HAS SIDO BLOQUEADO DE ESTA PLATAFORMA';
      } else {
        err.textContent = 'No se pudo conectar. Comprueba tu conexión y vuelve a intentarlo.';
        btn.disabled = false;
        btn.textContent = 'Entrar';
      }
    }
  });

  input.focus();
}

router({
  '/login': () => {
    setTimeout(bindLogin, 0);
    return loginView();
  },
  '/dashboard': () => {
    setTimeout(bindDashboard, 0);
    return shell(dashboardView(), '/dashboard');
  },
  '/chat': () => {
    setTimeout(bindChat, 0);
    return shell(chatView(), '/chat');
  },
  '/calendario': () => {
    setTimeout(bindCalendario, 0);
    return shell(calendarioView(), '/calendario');
  },
  '/examenes': () => {
    setTimeout(bindExamenes, 0);
    return shell(examenesView(), '/examenes');
  },
  '/horario': () => {
    setTimeout(bindHorario, 0);
    return shell(horarioView(), '/horario');
  },
  '/noticias': () => {
    setTimeout(bindNoticias, 0);
    return shell(noticiasView(), '/noticias');
  },
  '/perfil': () => {
    setTimeout(bindPerfil, 0);
    return shell(perfilView(), '/perfil');
  },
  '/perfiles': () => {
    setTimeout(bindPerfiles, 0);
    return shell(perfilesView(), '/perfiles');
  },
  '/ia': () => {
    setTimeout(bindIA, 0);
    return shell(iaView(), '/ia');
  }
});
