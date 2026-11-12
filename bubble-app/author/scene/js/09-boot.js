/* 09 — wiring: Bubble draws and redraws its elements whenever data arrives, so one observer schedules
   a single decorate pass on the next frame after any change that is not our own. Every decorate step
   is idempotent (it only writes when something differs). */
let decorateQueued = false;

function decorate() {
  decorateQueued = false;
  const steps = [renderShelf, decorateKpis, decorateTable, decorateBooks, decorateLetters];
  steps.forEach((step) => {
    try {
      step();
    } catch (err) {
      // One broken decoration must never stop the others or touch the page's data.
      if (window.console) console.warn('[BookLeaf author scene]', step.name, err);
    }
  });
  const el = document.getElementById('bl-shelf');
  if (el) { watchAmbient(el); syncAmbient(); }
}

function scheduleDecorate() {
  if (decorateQueued) return;
  decorateQueued = true;
  requestAnimationFrame(decorate);
}

/** A change is ours when it happens inside a node we added, or is a count-up frame. */
function isOwnChange(m) {
  const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
  if (animating.has(m.target)) return true;
  if (t && t.closest && t.closest(`[${OWN}], #bl-shelf`)) return true;
  const added = Array.from(m.addedNodes).concat(Array.from(m.removedNodes));
  return added.length > 0 && added.every((n) => n.nodeType === 1 && n.hasAttribute(OWN));
}

new MutationObserver((list) => {
  if (list.some((m) => !isOwnChange(m))) scheduleDecorate();
}).observe(document.body || root, { childList: true, subtree: true, characterData: true });

window.addEventListener('resize', () => { sizeDust(); scheduleDecorate(); }, { passive: true });
window.addEventListener('pointermove', (e) => { if (SH.el) lampTo(e.clientX, e.clientY); }, { passive: true });
window.addEventListener('bl-theme-change', scheduleDecorate);
document.addEventListener('visibilitychange', syncAmbient);
if (mqReduce && mqReduce.addEventListener) mqReduce.addEventListener('change', syncAmbient);
scheduleDecorate();
