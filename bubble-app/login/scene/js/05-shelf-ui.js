/* 05 — shelf UI: hover tooltip, keyboard toolbar (roving tabindex), click a spine to open it. */
const TIP_HALF = 120;
let tipFor = null;

function showTip(el) {
  const b = BOOKS[+el.dataset.i];
  if (!D.tip || !b) return;
  tipFor = el;
  const status = isProd(b)
    ? `<em class="prod">In production · ${STAGES[b.stageIdx]}</em>`
    : '<em class="live">Published &amp; Live</em>';
  D.tip.innerHTML = `<b>${esc(b.t)}</b><span>${esc(b.g)}</span>${status}`;
  placeTip();
  D.tip.classList.add('on');
}

function placeTip() {
  if (!tipFor || !D.tip) return;
  const r = tipFor.getBoundingClientRect();
  const sr = D.shelf.getBoundingClientRect();
  const x = Math.max(TIP_HALF + 8, Math.min(sr.width - TIP_HALF, r.left + r.width / 2 - sr.left));
  D.tip.style.left = `${x}px`;
  D.tip.style.top = `${r.top - sr.top - 12}px`;
}

function hideTip() {
  tipFor = null;
  if (D.tip) D.tip.classList.remove('on');
}

function onTrackOver(e) {
  const sp = e.target.closest('.spine');
  if (sp && !S.drag && e.pointerType !== 'touch') showTip(sp);
}

function onTrackOut(e) {
  const sp = e.target.closest('.spine');
  if (sp && !sp.contains(e.relatedTarget)) hideTip();
}

/* A keyboard-focused spine scrolls to the centre of the shelf and shows its tooltip. */
function onTrackFocusIn(e) {
  const sp = e.target.closest('.spine');
  if (!sp || !sp.matches(':focus-visible') || openState) return;
  S.focusIn = true;
  S.v = 0;
  S.focusTarget = S.vpW / 2 - (sp.offsetLeft + sp.offsetWidth / 2);
  showTip(sp);
}

function onTrackFocusOut(e) {
  if (D.track.contains(e.relatedTarget)) return;
  S.focusIn = false;
  S.focusTarget = null;
  hideTip();
}

function keyToIndex(key, idx, n) {
  if (key === 'ArrowRight') return (idx + 1) % n;
  if (key === 'ArrowLeft') return (idx - 1 + n) % n;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return -1;
}

function onTrackKey(e) {
  const sp = e.target.closest('.spine');
  if (!sp || !realSpines.length) return;
  const next = keyToIndex(e.key, realSpines.indexOf(sp), realSpines.length);
  if (next < 0) return;
  e.preventDefault();
  realSpines.forEach((el) => { el.tabIndex = -1; });
  realSpines[next].tabIndex = 0;
  realSpines[next].focus({ preventScroll: true });
}

function onTrackClick(e) {
  const sp = e.target.closest('.spine');
  if (!sp) return;
  if (S.moved) { e.preventDefault(); S.moved = false; return; }
  openBook(sp);
}

function bindShelfUi() {
  D.track.addEventListener('pointerover', onTrackOver);
  D.track.addEventListener('pointerout', onTrackOut);
  D.track.addEventListener('focusin', onTrackFocusIn);
  D.track.addEventListener('focusout', onTrackFocusOut);
  D.track.addEventListener('keydown', onTrackKey);
  D.track.addEventListener('click', onTrackClick);
}
