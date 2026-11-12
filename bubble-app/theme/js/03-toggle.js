/* 03 — wiring: one delegated click listener, so a toggle Bubble re-renders later still works.
   Any element with [data-bl-theme-toggle] switches the theme (top bar, floating, or custom). */
function syncPressed() {
  const dark = root.dataset.theme === 'dark';
  document.querySelectorAll('[data-bl-theme-toggle]').forEach((btn) => {
    btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    btn.setAttribute('title', dark ? 'Switch to light theme' : 'Switch to dark theme');
  });
}

document.addEventListener('click', (e) => {
  const btn = e.target && e.target.closest ? e.target.closest('[data-bl-theme-toggle]') : null;
  if (!btn) return;
  e.preventDefault();
  toggleTheme(btn);
});

window.addEventListener('bl-theme-change', syncPressed);
syncPressed();
/* Bubble draws the top bar after this script may have run: label late toggles too. */
setTimeout(syncPressed, 800);
setTimeout(syncPressed, 2500);
