/* 05 — ambience over the shelf: a warm lamp pool and glowing dust (dark), soft morning light and pale
   motes (light). It runs only while the shelf is on screen and the tab is visible, and not at all
   under reduced motion (the light then rests over the books). */
const AMB = { x: 0, y: 0, tx: 0, ty: 0, moved: 0, raf: 0, last: 0, onScreen: true, motes: [], w: 0, h: 0, ctx: null };
const LAMP_IDLE_MS = 2400;
const MOTES = 22;

/** Pointer position (client coordinates) for the lamp to follow for a moment. */
function lampTo(x, y) { AMB.tx = x; AMB.ty = y; AMB.moved = performance.now(); }

function stageOf() { return SH.el ? qs('.bl-shelf-stage', SH.el) : null; }

function sizeDust() {
  const stage = stageOf(); const canvas = stage && qs('.bl-shelf-dust', stage);
  if (!canvas || !canvas.getContext) return;
  const r = stage.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  AMB.w = r.width; AMB.h = r.height;
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  AMB.ctx = canvas.getContext('2d');
  AMB.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const R = rng(17);
  AMB.motes = Array.from({ length: MOTES }, () => ({ x: R() * r.width, y: R() * r.height, r: 0.6 + R() * 1.4, vx: (R() - 0.5) * 5, vy: -1.5 - R() * 4, ph: R() * 6.28 }));
  if (!AMB.x) { AMB.x = r.width * 0.45; AMB.y = r.height * 0.5; }
  placeLight(isReduced());
}

/** Where the light wants to be: the pointer when it moved lately, else a slow drift over the books. */
function lightTarget(now, r, still) {
  const recent = now - AMB.moved < LAMP_IDLE_MS;
  if (recent && AMB.tx > r.left - 40 && AMB.tx < r.right + 40 && AMB.ty > r.top - 60 && AMB.ty < r.bottom + 60) {
    return { x: AMB.tx - r.left, y: AMB.ty - r.top };
  }
  const t = still ? 0 : now;
  return { x: r.width * (0.42 + Math.sin(t * 0.00021) * 0.2), y: r.height * (0.5 + Math.sin(t * 0.00037) * 0.12) };
}

function placeLight(still, now = 0, dt = 1) {
  const stage = stageOf(); const light = stage && qs('.bl-shelf-light', stage);
  if (!light) return;
  const target = lightTarget(now, stage.getBoundingClientRect(), still);
  const k = still ? 1 : 1 - Math.exp(-dt * 4);
  AMB.x += (target.x - AMB.x) * k; AMB.y += (target.y - AMB.y) * k;
  light.style.setProperty('--lx', `${AMB.x.toFixed(1)}px`);
  light.style.setProperty('--ly', `${AMB.y.toFixed(1)}px`);
}

/** Dark: motes glow inside the lamp pool. Light: they catch the slanted morning light. */
function moteColour(m) {
  if (isDark()) {
    const a = 0.05 + Math.max(0, 1 - Math.hypot(m.x - AMB.x, m.y - AMB.y) / 170) * 0.7;
    return `rgba(255, 214, 160, ${a.toFixed(3)})`;
  }
  const band = Math.sin((m.x * 0.9 + m.y * 0.6) * 0.016 + 1.1);
  return `rgba(255, 255, 255, ${(0.25 + Math.max(0, band) * 0.6).toFixed(3)})`;
}

function drawDust(dt, now) {
  const c = AMB.ctx;
  if (!c) return;
  c.clearRect(0, 0, AMB.w, AMB.h);
  AMB.motes.forEach((m) => {
    m.x += (m.vx + Math.sin(now * 0.0004 + m.ph) * 3) * dt; m.y += m.vy * dt;
    if (m.y < -4) { m.y = AMB.h + 4; m.x = Math.random() * AMB.w; }
    if (m.x < -4) m.x = AMB.w + 4; else if (m.x > AMB.w + 4) m.x = -4;
    c.fillStyle = moteColour(m);
    c.beginPath(); c.arc(m.x, m.y, m.r, 0, 6.2832); c.fill();
  });
}

function ambientFrame(now) {
  const dt = Math.min(0.05, (now - AMB.last) / 1000);
  AMB.last = now;
  placeLight(false, now, dt);
  drawDust(dt, now);
  AMB.raf = requestAnimationFrame(ambientFrame);
}

/** Start or stop the loop to match: on screen, tab visible, motion allowed. */
function syncAmbient() {
  const run = AMB.onScreen && !document.hidden && !isReduced() && !!SH.el;
  if (run && !AMB.raf) { AMB.last = performance.now(); AMB.raf = requestAnimationFrame(ambientFrame); }
  if (!run && AMB.raf) { cancelAnimationFrame(AMB.raf); AMB.raf = 0; }
  if (!run && AMB.ctx && isReduced()) { AMB.ctx.clearRect(0, 0, AMB.w, AMB.h); placeLight(true); }
}

function watchAmbient(el) {
  if (el.__blSeen || !window.IntersectionObserver) return;
  el.__blSeen = true;
  new IntersectionObserver((entries) => { AMB.onScreen = entries.some((e) => e.isIntersecting); syncAmbient(); }).observe(el);
}
