/* 04 — the shelf: build the spines, endless drift, pointer parallax, drag with momentum, wheel. */
const COPIES = 4;
const REAL = 1;
const PLANT_AFTER = 8;
const DRIFT = 16;
const PARALLAX = 26;
const DRAG_START_PX = 6;
const WHEEL_MAX_V = 2600;

/* Shared shelf state (read by the tooltip, the book stage, the main loop and the card bridge). */
const S = {
  off: 0, v: 0, setW: 1000, vpW: 800, px: 0, pxT: 0, ready: false,
  drag: null, moved: false, hover: false, focusIn: false, focusTarget: null,
  paused: false, modal: false, busy: false, closing: false, lastBook: undefined,
};
let realSpines = [];

function makeSpine(b, i, isReal) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'spine';
  el.dataset.i = String(i);
  el.style.setProperty('--w', b.w);
  el.style.setProperty('--h', b.h);
  el.style.setProperty('--gap', `${2 + ((i * 7) % 4)}px`);
  const status = isProd(b) ? `In production: ${STAGES[b.stageIdx]}` : 'Published and live';
  el.setAttribute('aria-label', `${b.t}. ${b.g}. ${status}. Pull out to preview.`);
  el.tabIndex = isReal && i === 0 ? 0 : -1;
  let tag = '';
  if (b.status === 'cover') tag = '<span class="sp-tag amber" aria-hidden="true">Cover design</span>';
  if (b.status === 'type') tag = '<span class="sp-tag blue" aria-hidden="true">Typesetting</span>';
  el.innerHTML = spineArtHTML(b) + tag;
  return el;
}

function makeSet(isReal) {
  const set = document.createElement('div');
  set.className = 'set';
  if (!isReal) set.setAttribute('aria-hidden', 'true');
  BOOKS.forEach((b, i) => {
    set.appendChild(makeSpine(b, i, isReal));
    if (i === PLANT_AFTER) set.insertAdjacentHTML('beforeend', PLANT_SVG);
  });
  return set;
}

/* Four copies of the set make the endless loop; only copy REAL is in the accessibility tree. */
function buildShelf() {
  if (!qs('.set', D.track)) {
    const frag = document.createDocumentFragment();
    for (let c = 0; c < COPIES; c += 1) frag.appendChild(makeSet(c === REAL));
    D.track.appendChild(frag);
  }
  const sets = qsa('.set', D.track);
  realSpines = sets[REAL] ? qsa('.spine', sets[REAL]) : [];
}

function measure() {
  if (!SCENE_OK) return;
  const mobile = window.innerWidth <= MOBILE_MAX;
  const shelfH = mobile ? 200 : Math.max(186, Math.min(330, window.innerHeight * .355));
  root.style.setProperty('--shelfH', `${shelfH}px`);
  root.style.setProperty('--k', (shelfH / 280).toFixed(4));
  const set = qs('.set', D.track);
  if (set) S.setW = Math.max(1, set.getBoundingClientRect().width);
  S.vpW = D.vp.clientWidth;
  if (!S.ready) { S.off = -S.setW; S.ready = true; }
  wrap();
  sizeDust();
}

/* Keep the offset inside (-2·setW, -setW] so the loop never shows an edge. */
function wrap() {
  if (S.focusIn || S.setW < 1) return;
  const w = S.setW;
  const u = (((-w - S.off) % w) + w) % w;
  S.off = -w - u;
}

function onShelfPointerDown(e) {
  if (e.button !== 0) return;
  S.drag = { x: e.clientX, last: e.clientX, t: performance.now(), id: e.pointerId };
  S.moved = false;
  S.v = 0;
}

function startDragging(e) {
  S.moved = true;
  D.vp.classList.add('dragging');
  try {
    D.vp.setPointerCapture(e.pointerId);
  } catch (err) {
    /* pointer capture is best-effort: the window listeners still track the drag */
  }
  hideTip();
}

function onWindowPointerMove(e) {
  S.pxT = (e.clientX / window.innerWidth - .5) * 2;
  if (!S.drag || e.pointerId !== S.drag.id) return;
  const now = performance.now();
  const dx = e.clientX - S.drag.last;
  if (!S.moved && Math.abs(e.clientX - S.drag.x) > DRAG_START_PX) startDragging(e);
  if (S.moved) {
    S.off += dx;
    const dt = Math.max(1, now - S.drag.t);
    S.v = S.v * .6 + (dx / dt) * 1000 * .4;
  }
  S.drag.last = e.clientX;
  S.drag.t = now;
}

function endDrag(e) {
  if (!S.drag || (e && e.pointerId !== S.drag.id)) return;
  D.vp.classList.remove('dragging');
  if (performance.now() - S.drag.t > 90) S.v = 0;
  S.drag = null;
}

function onShelfWheel(e) {
  if (window.innerWidth <= MOBILE_MAX && Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
  e.preventDefault();
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  S.v = Math.max(-WHEEL_MAX_V, Math.min(WHEEL_MAX_V, S.v - d * 9));
  hideTip();
}

function bindShelf() {
  D.vp.addEventListener('pointerenter', () => { S.hover = true; });
  D.vp.addEventListener('pointerleave', () => { S.hover = false; });
  D.vp.addEventListener('pointerdown', onShelfPointerDown);
  window.addEventListener('pointermove', onWindowPointerMove, { passive: true });
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  D.vp.addEventListener('wheel', onShelfWheel, { passive: false });
  D.vp.addEventListener('scroll', () => { D.vp.scrollLeft = 0; });
}
