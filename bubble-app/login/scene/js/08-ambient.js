/* 08 — ambience and the main loop: shelf drift, the lamp-light pool (dark) / morning motes (light),
   dust on a canvas, and the spine drop-in entrance. The loop stops while the tab is hidden. */
const LAMP_IDLE_MS = 2600;
const ENTRANCE_CLEAR_MS = 1400;
const lamp = { x: 0, y: 0, tx: 0, ty: 0, active: false, lastMove: 0 };
const dctx = D.dust && D.dust.getContext ? D.dust.getContext('2d') : null;
let motes = [];
let dustW = 0;
let dustH = 0;
let lastFrame = performance.now();
let rafId = 0;

function sizeDust() {
  if (!dctx || !D.vp) return;
  const r = D.vp.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  dustW = r.width; dustH = r.height;
  D.dust.width = Math.round(r.width * dpr);
  D.dust.height = Math.round(r.height * dpr);
  dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const n = window.innerWidth <= MOBILE_MAX ? 26 : 58;
  const R = rng(42);
  motes = Array.from({ length: n }, () => ({ x: R() * dustW, y: R() * dustH, r: .6 + R() * 1.6, vx: (R() - .5) * 6, vy: -2 - R() * 5, ph: R() * 6.28 }));
}

function moveMote(m, dt, t) {
  m.x += (m.vx + Math.sin(t * .0004 + m.ph) * 4) * dt;
  m.y += m.vy * dt;
  if (m.y < -4) { m.y = dustH + 4; m.x = Math.random() * dustW; }
  if (m.x < -4) m.x = dustW + 4;
  else if (m.x > dustW + 4) m.x = -4;
}

/* Dark: motes glow inside the lamp pool. Light: white motes brighten inside the light shafts. */
function moteColour(m, dark, lx, ly) {
  if (dark) {
    const a = .06 + Math.max(0, 1 - Math.hypot(m.x - lx, m.y - ly) / 300) * .75;
    return `rgba(255, 214, 160, ${a.toFixed(3)})`;
  }
  const band = Math.sin((m.x * .9 + m.y * .5) * .012 + 1.2);
  return `rgba(255, 255, 255, ${(.15 + Math.max(0, band) * .5).toFixed(3)})`;
}

function drawDust(dt, t, lx, ly) {
  if (!dctx) return;
  dctx.clearRect(0, 0, dustW, dustH);
  const dark = root.dataset.theme === 'dark';
  motes.forEach((m) => {
    moveMote(m, dt, t);
    dctx.fillStyle = moteColour(m, dark, lx, ly);
    dctx.beginPath();
    dctx.arc(m.x, m.y, m.r, 0, 6.2832);
    dctx.fill();
  });
}

/* Ease toward a focused spine, or toward the slow drift (paused on hover, open book or flight). */
function driftShelf(dt, reduced) {
  if (S.focusTarget !== null) {
    S.off += (S.focusTarget - S.off) * (1 - Math.exp(-dt * 9));
    S.v = 0;
    return;
  }
  const target = (S.hover || S.modal || reduced || S.paused) ? 0 : -DRIFT;
  S.v += (target - S.v) * (1 - Math.exp(-dt * (Math.abs(S.v) > 60 ? 2.2 : 1.2)));
  S.off += S.v * dt;
}

function stepShelf(dt, reduced) {
  if (!S.drag) driftShelf(dt, reduced);
  wrap();
  S.px += ((reduced ? 0 : S.pxT) - S.px) * (1 - Math.exp(-dt * 4));
  D.track.style.transform = `translate3d(${(S.off - S.px * PARALLAX).toFixed(2)}px,0,0)`;
  if (D.wallDots) D.wallDots.style.transform = `translate3d(${(-S.px * 10).toFixed(2)}px,0,0)`;
  if (tipFor) placeTip();
}

/* Follow the pointer while it is over the scene; otherwise an idle orbit over the shelf. */
function lampTarget(now, r, reduced) {
  const recent = now - lamp.lastMove < LAMP_IDLE_MS;
  if (lamp.active && recent && lamp.tx < r.right + 60 && lamp.ty > r.top - 160) {
    return { tx: lamp.tx - r.left, ty: lamp.ty - r.top };
  }
  const tt = reduced ? 0 : now;
  return { tx: r.width * (.42 + Math.sin(tt * .00023) * .26), ty: r.height * (.52 + Math.sin(tt * .00041) * .14) };
}

function stepLamp(now, dt, reduced) {
  const { tx, ty } = lampTarget(now, D.vp.getBoundingClientRect(), reduced);
  const k = 1 - Math.exp(-dt * (reduced ? 30 : 6));
  lamp.x += (tx - lamp.x) * k;
  lamp.y += (ty - lamp.y) * k;
  const lx = `${lamp.x.toFixed(1)}px`; const ly = `${lamp.y.toFixed(1)}px`;
  [D.night, D.glow].forEach((el) => {
    if (!el) return;
    el.style.setProperty('--lx', lx);
    el.style.setProperty('--ly', ly);
  });
  if (!reduced) drawDust(dt, now, lamp.x, lamp.y);
}

function frame(now) {
  const dt = Math.min(.05, (now - lastFrame) / 1000);
  lastFrame = now;
  const reduced = isReduced();
  stepShelf(dt, reduced);
  stepLamp(now, dt, reduced);
  rafId = requestAnimationFrame(frame);
}

function startLoop() {
  if (rafId) return;
  lastFrame = performance.now();
  rafId = requestAnimationFrame(frame);
}

function stopLoop() {
  cancelAnimationFrame(rafId);
  rafId = 0;
}

/* Entrance: spines drop in, left to right across the visible part of the shelf. */
function staggerEntrance() {
  if (isReduced()) { D.track.classList.add('no-anim'); return; }
  const vr = D.vp.getBoundingClientRect();
  qsa('.spine', D.track).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.right < vr.left || r.left > vr.right) { el.style.animation = 'none'; return; }
    const p = (r.left - vr.left) / Math.max(1, vr.width);
    el.style.setProperty('--d', `${Math.round(220 + p * 520)}ms`);
  });
  setTimeout(() => qsa('.spine', D.track).forEach((el) => { el.style.animation = 'none'; }), ENTRANCE_CLEAR_MS);
}

function bindAmbient() {
  window.addEventListener('pointermove', (e) => {
    lamp.tx = e.clientX; lamp.ty = e.clientY; lamp.active = true; lamp.lastMove = performance.now();
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop();
    else startLoop();
  });
}
