// The page script for the in-place "Regenerate draft" animation. It reads the pop-up's hidden anchor
// (regenAnchor.mjs), works out the phase with the pure rules in regenLogic.mjs, and lays a mask over
// the subject, the email text box and the preview: ink being written while n8n works, a short
// "Done" when the draft is ready, then the new text fades in; on failure, a calm note instead.
// Bubble keeps the pop-up, its size and its scroll position; this script only draws on top.
import { regenPhase, regenMove, regenStep, regenStepLabel, regenStamp, regenElapsed, regenFailNote } from './regenLogic.mjs';
import { maskMarkup } from './regenDraw.mjs';
import { REGEN_CSS } from './regen.css.mjs';

/** Pop-up elements (HTML ids) that get a mask, and the kind of mask each one gets. */
export const REGEN_TARGETS = { ad_rv_subj: 'line', ad_rv_body: 'text', ad_rv_prev: 'mail' };
/** HTML id of the Regenerate button: a click shows the mask at once, before Bubble's data moves. */
export const REGEN_BUTTON_ID = 'ad_rv_regen';
/** Buttons kept non-clickable during the "Done ✓" hold and fade-in (Bubble re-enables them at once). */
export const REGEN_LOCK_IDS = ['ad_rv_discard', 'ad_rv_check', 'ad_rv_approve'];
/** How long "Done ✓" stays before the new draft fades in (ms). */
export const DONE_HOLD_MS = 800;

const MARKUP = JSON.stringify(Object.fromEntries(['text', 'mail', 'line'].map((k) => [k, maskMarkup(k)])));

// Finding targets and laying masks over them (masks sit in the target's parent, outside Bubble's layout).
const MASKS = `
  function shown(id) { var t = document.getElementById(id); return t && t.getClientRects().length ? t : null; }
  function maskFor(id) {
    var t = shown(id), m = ui.masks[id];
    if (!t) return null;
    var host = t.parentElement;
    if (m && m.parentElement === host) return m;
    if (m) m.remove();
    m = document.createElement('div'); m.className = 'bl-rg'; m.setAttribute('data-kind', TARGETS[id]);
    m.innerHTML = MARKUP[TARGETS[id]];
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(m); ui.masks[id] = m;
    var x = m.querySelector('.bl-rg-note-x'); if (x) x.addEventListener('click', function () { drop(id); });
    return m;
  }
  function place(id) {
    var m = ui.masks[id], t = shown(id); if (!m) return;
    if (!t) return drop(id);
    var host = m.parentElement, a = t.getBoundingClientRect(), h = host.getBoundingClientRect();
    m.style.top = (a.top - h.top - host.clientTop + host.scrollTop) + 'px';
    m.style.left = (a.left - h.left - host.clientLeft + host.scrollLeft) + 'px';
    m.style.width = a.width + 'px'; m.style.height = a.height + 'px';
    m.style.borderRadius = getComputedStyle(t).borderRadius;
    var sc = t.closest('.ad_rv_scroll'), fold = sc ? sc.getBoundingClientRect().bottom : window.innerHeight;
    m.style.setProperty('--vis-b', Math.max(0, Math.min(a.bottom - fold, a.height - 90)) + 'px');
  }
  function drop(id) { var m = ui.masks[id]; if (m) m.remove(); delete ui.masks[id]; var t = document.getElementById(id); if (t) t.removeAttribute('aria-busy'); }
  function each(fn) { Object.keys(TARGETS).forEach(fn); }`;

// The words on the mask: the step, its dots and the seconds counter.
const WORDS = `
  function setStep(m, text) {
    var el = m.querySelector('.bl-rg-step'); if (!el || el.textContent === text) return;
    el.textContent = text; el.classList.remove('is-new'); void el.offsetWidth; el.classList.add('is-new');
  }
  function words(src, now) {
    var started = src && src.log && src.log !== src.prev;
    var step = started ? regenStep(src.stage) : -1, label = regenStepLabel(Math.min(step, 2));
    var secs = regenElapsed(ui.clickedAt || regenStamp(src && src.start), now);
    each(function (id) {
      var m = ui.masks[id]; if (!m || m.getAttribute('data-phase') !== 'live') return;
      setStep(m, id === 'ad_rv_prev' ? (step < 0 ? 'New preview on its way' : label) : label);
      var t = m.querySelector('.bl-rg-t'); if (t) t.textContent = secs;
      m.querySelectorAll('.bl-rg-dots i').forEach(function (d, k) { d.className = k < step ? 'done' : k === step ? 'now' : ''; });
    });
  }`;

// Phase changes: start writing, finish with "Done", fail calmly, or clear.
const MOVES = `
  function enter() {
    keepScroll();
    each(function (id) {
      var m = maskFor(id); if (!m) return;
      m.innerHTML = MARKUP[TARGETS[id]]; m.classList.remove('is-out'); m.setAttribute('data-phase', 'live');
      var t = document.getElementById(id); t.setAttribute('aria-busy', 'true');
      if (t.contains(document.activeElement)) document.activeElement.blur();
    });
  }
  function lock(on) {
    LOCK.forEach(function (id) {
      var b = document.getElementById(id); if (!b) return;
      b.style.pointerEvents = on ? 'none' : ''; if (on) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
    });
  }
  function done() {
    ui.holding = true; keepScroll(); lock(true);
    each(function (id) {
      var m = ui.masks[id]; if (!m) return;
      m.setAttribute('data-phase', 'done'); setStep(m, 'Done \\u2713');
      m.querySelectorAll('.bl-rg-dots i').forEach(function (d) { d.className = 'done'; });
    });
    setTimeout(function () {
      each(function (id) {
        var m = ui.masks[id], t = document.getElementById(id); if (m) m.classList.add('is-out');
        if (t) { t.classList.remove('bl-rg-in'); void t.offsetWidth; t.classList.add('bl-rg-in'); }
      });
      setTimeout(function () { each(drop); lock(false); ui.holding = false; }, 460);
    }, ${DONE_HOLD_MS});
  }
  function fail(src) {
    each(function (id) { if (id !== 'ad_rv_body') drop(id); });
    var m = maskFor('ad_rv_body'); if (!m) return;
    var n = regenFailNote(src && src.error, !!(src && src.prev && src.prev === src.log));
    m.setAttribute('data-phase', 'failed');
    m.querySelector('.bl-rg-note-t').textContent = n.title; m.querySelector('.bl-rg-note-d').textContent = n.detail;
    document.getElementById('ad_rv_body').removeAttribute('aria-busy');
  }
  function keepScroll() {
    var sc = document.querySelector('.ad_rv_scroll'); if (!sc || sc.scrollTop < 1) return;
    var top = sc.scrollTop, until = Date.now() + 1600;
    (function watch() { if (sc.scrollTop === 0) sc.scrollTop = top; if (Date.now() < until) requestAnimationFrame(watch); })();
  }`;

const LOOP = `
  function source() { var el = document.querySelector('.bl-regen-src'); return el ? el.dataset : null; }
  function tick() {
    var now = Date.now(), src = source(), open = !!shown('ad_rv_body');
    if (!open) ui.clickedAt = 0;
    if (!ui.holding) {
      var phase = open ? regenPhase(src, ui.clickedAt, now) : 'idle', move = regenMove(ui.phase, phase);
      ui.phase = phase;
      if (move === 'enter') enter(); else if (move === 'done') done(); else if (move === 'fail') fail(src); else if (move === 'clear') each(drop);
    }
    words(src, now); each(place);
  }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('#${REGEN_BUTTON_ID}');
    if (b && !b.disabled && b.getAttribute('aria-disabled') !== 'true') ui.clickedAt = Date.now();
  }, true);
  setInterval(tick, 200); tick();`;

export const REGEN_SCRIPT = `
<script>
(function () {
  if (window.__blRegen) return; window.__blRegen = true;
  var TARGETS = ${JSON.stringify(REGEN_TARGETS)}, MARKUP = ${MARKUP}, LOCK = ${JSON.stringify(REGEN_LOCK_IDS)};
  var ui = { phase: 'idle', clickedAt: 0, holding: false, masks: {} };
  ${regenPhase.toString()}
  ${regenMove.toString()}
  ${regenStep.toString()}
  ${regenStepLabel.toString()}
  ${regenStamp.toString()}
  ${regenElapsed.toString()}
  ${regenFailNote.toString()}
${MASKS}
${WORDS}
${MOVES}
${LOOP}
})();
</script>`;

/** CSS + script, for the page's style element (assets.mjs). */
export const REGEN_HTML = REGEN_CSS + REGEN_SCRIPT;
