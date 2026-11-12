/* 01 — shared helpers, reduced motion, scene element lookups, theme init + persistence.
   Every file in scene/js/ is joined in name order inside ONE function, so top-level names are shared. */
const root = document.documentElement;
const byId = (id) => document.getElementById(id);
const qs = (sel, scope = document) => (scope ? scope.querySelector(sel) : null);
const qsa = (sel, scope = document) => (scope ? Array.from(scope.querySelectorAll(sel)) : []);
const mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
const isReduced = () => !!(mqReduce && mqReduce.matches);
const hasGsap = () => typeof window.gsap !== 'undefined';
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
/* QA helper: add ?slowink to the URL to run the ink splash 6× slower for screenshots. */
const SLOW = /[?&]slowink\b/.test(window.location.search) ? 6 : 1;
const MOBILE_MAX = 860;

/* Seeded random numbers (mulberry32), so generated art is stable between visits. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ═════════ scene elements (the markup is already in the DOM when this runs) ═════════ */
const D = {
  scene: byId('bl-scene'),
  track: byId('track'),
  vp: byId('shelf-vp'),
  shelf: byId('shelf'),
  tip: byId('tip'),
  stage: byId('stage'),
  backdrop: byId('backdrop'),
  bkShadow: byId('bk-shadow'),
  bkClose: byId('bk-close'),
  night: byId('night'),
  glow: byId('glow'),
  dust: byId('dust'),
  wallDots: byId('wall-dots'),
  toggle: byId('theme-toggle'),
};
/* The shelf and the book stage need these four; everything else is optional and guarded. */
const SCENE_OK = !!(D.track && D.vp && D.shelf && D.stage);

/* ═════════ theme: saved choice, else the system setting ═════════ */
const THEME_KEY = 'bl-login-theme';

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

function themeLabel() {
  if (!D.toggle) return;
  const dark = root.dataset.theme === 'dark';
  D.toggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
}

function applyTheme(theme) {
  root.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch (err) {
    /* storage blocked: the theme still applies for this visit */
  }
  themeLabel();
}

/* Set the theme right away (the head snippet may already have done it; this is idempotent). */
root.setAttribute('data-theme', readTheme());
