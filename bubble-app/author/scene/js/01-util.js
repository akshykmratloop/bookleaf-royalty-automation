/* 01 — helpers shared by every author scene file. All files (and the login's 03-spines.js art) are
   joined in name order inside ONE function, so top-level names are shared. Nothing here touches data. */
const root = document.documentElement;
const qs = (sel, scope = document) => (scope ? scope.querySelector(sel) : null);
const qsa = (sel, scope = document) => (scope ? Array.from(scope.querySelectorAll(sel)) : []);
const mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
const isReduced = () => !!(mqReduce && mqReduce.matches);
const isDark = () => root.dataset.theme === 'dark';
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
/** Marks every node this script adds, so the change observer can ignore our own edits. */
const OWN = 'data-bl-au';

/* Seeded random numbers (mulberry32): the login's cover motifs use it, so the art is stable. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The text an element shows, with whitespace collapsed ('' for a missing element). */
const textOf = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

/** Rupees as Bubble shows them (symbol, Indian digit grouping) -> a number. Null when the text holds no number yet (Bubble still loading). */
function amount(text) {
  const digits = String(text || '').replace(/[^\d.-]/g, '');
  if (!/\d/.test(digits)) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

/** Whole rupees with Indian grouping, as Bubble shows them (used only for in-between count-up frames). */
const rupees = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** Titles compared loosely: case, curly quotes and spacing do not matter. */
const titleKey = (t) => String(t || '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

/** Is the element on screen (Bubble hides elements with display:none or leaves them out)? */
const isShown = (el) => !!(el && el.getClientRects().length);

/** A new element of ours: make('span', 'bl-x', 'text'). */
function make(tag, cls, text) {
  const el = document.createElement(tag);
  el.className = cls;
  el.setAttribute(OWN, '');
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Small stable hash, for picking a look for a title the login catalogue does not know. */
function hashOf(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
