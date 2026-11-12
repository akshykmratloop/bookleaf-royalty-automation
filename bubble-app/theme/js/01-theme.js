/* 01 — theme state: saved choice (shared with the login page), else the system setting.
   Every file in theme/js/ is joined in name order inside ONE function, so top-level names are shared. */
const root = document.documentElement;
const THEME_KEY = '__BL_THEME_KEY__';
const mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
const isReduced = () => !!(mqReduce && mqReduce.matches);

function readTheme() {
  let saved = null;
  try {
    saved = window.localStorage.getItem(THEME_KEY);
  } catch (err) {
    saved = null; // storage blocked (private mode, sandbox): fall back to the system setting
  }
  if (saved === 'light' || saved === 'dark') return saved;
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

/** Sets the theme, saves it, and tells listeners (charts redraw on `bl-theme-change`). */
function applyTheme(theme) {
  root.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch (err) {
    /* storage blocked: the theme still applies for this visit */
  }
  window.dispatchEvent(new CustomEvent('bl-theme-change', { detail: { theme } }));
}

/* Seeded random numbers (mulberry32), so a splash can be rebuilt from its seed. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

root.setAttribute('data-theme', readTheme());

/* Another tab (or the login page) changed the theme: follow it. */
window.addEventListener('storage', (e) => {
  if (e.key === THEME_KEY && (e.newValue === 'light' || e.newValue === 'dark') && e.newValue !== root.dataset.theme) {
    root.dataset.theme = e.newValue;
    window.dispatchEvent(new CustomEvent('bl-theme-change', { detail: { theme: e.newValue } }));
  }
});
