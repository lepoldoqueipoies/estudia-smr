// Runs before CSS is painted; the preference is separate from account data.
(() => {
  const key = 'studia-theme';
  let theme = 'dark';
  try { if (localStorage.getItem(key) === 'light') theme = 'light'; } catch {}
  document.documentElement.dataset.theme = theme;
  function update() {
    const button = document.getElementById('themeToggle');
    if (!button) return;
    const dark = document.documentElement.dataset.theme === 'dark';
    button.setAttribute('aria-label', dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    button.setAttribute('title', dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    button.setAttribute('aria-pressed', String(!dark));
    button.innerHTML = dark
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20.7 13.5A9 9 0 0 1 10.5 3.3 9 9 0 1 0 20.7 13.5Z"/></svg>';
  }
  document.addEventListener('DOMContentLoaded', () => {
    update();
    document.getElementById('themeToggle')?.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem(key, next); } catch {}
      update();
    });
  });
})();