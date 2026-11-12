/* 02 — ink-splash theme switch, ported from the login page (login/scene/js/02-ink.js):
   a View Transition masked by generated SVG ink blobs that spread from the clicked toggle.
   Fallbacks: reduced motion → plain 350 ms cross-fade; no View Transitions → CSS colour fade. */
const TAU = 6.2832;
const INK_POINTS = 200;
const INK_STEPS = 36;
const INK_MS = 1150;
const INK_DROPS = 8;
const INK_OCTAVES = [[3, .1], [5, .075], [8, .05], [13, .035], [21, .022], [34, .012]];
let inkBusy = false;

function inkShape(R, rough, spikes) {
  const oct = INK_OCTAVES.map(([f, a]) => [f, a * rough, R() * TAU]);
  const sp = Array.from({ length: spikes }, () => [R() * TAU, .035 + R() * .05, .1 + R() * .3]);
  return { oct, sp };
}

function inkRadiusAt(th, shape) {
  let r = 1;
  shape.oct.forEach(([f, a, ph]) => { r += a * Math.sin(f * th + ph); });
  shape.sp.forEach(([c, w, amp]) => {
    let d = Math.abs(th - c);
    d = Math.min(d, TAU - d);
    r += amp * Math.exp(-((d / w) ** 2));
  });
  return Math.min(r, 1.55);
}

/* Closed Catmull-Rom curve through the points, as SVG cubic segments. */
function inkPath(pts) {
  const n = pts.length;
  const f = (v) => v.toFixed(1);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i += 1) {
    const p0 = pts[(i - 1 + n) % n]; const p1 = pts[i]; const p2 = pts[(i + 1) % n]; const p3 = pts[(i + 2) % n];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

function inkDots(R, base, sats) {
  let dots = '';
  for (let k = 0; k < sats; k += 1) {
    const th = R() * TAU; const rr = base * (1.08 + R() * .32); const s = 3 + R() * R() * 16;
    const x = (500 + Math.cos(th) * rr).toFixed(1); const y = (500 + Math.sin(th) * rr).toFixed(1);
    dots += `<ellipse cx='${x}' cy='${y}' rx='${(s * (1 + R() * .9)).toFixed(1)}' ry='${s.toFixed(1)}' transform='rotate(${(th * 57.3).toFixed(0)} ${x} ${y})'/>`;
  }
  return dots;
}

/* One ink blob as a data-URI mask, plus its smallest radius (to size it past the screen corners). */
function inkSVG(seed, base, rough, spikes, sats) {
  const R = rng(seed);
  const shape = inkShape(R, rough, spikes);
  const pts = [];
  let rmin = Infinity;
  for (let i = 0; i < INK_POINTS; i += 1) {
    const th = (i / INK_POINTS) * TAU;
    const rr = base * inkRadiusAt(th, shape);
    rmin = Math.min(rmin, rr);
    pts.push([500 + Math.cos(th) * rr, 500 + Math.sin(th) * rr]);
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 1000'><g fill='#000'><path d='${inkPath(pts)}'/>${inkDots(R, base, sats)}</g></svg>`;
  return { url: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, rmin: rmin / 500 };
}

const inkEase = (u) => 1 - ((1 - u) ** 1.7) * (1 + .7 * u);

function inkGeometry(seed, btn) {
  const tr = btn.getBoundingClientRect();
  const cx = tr.left + tr.width / 2; const cy = tr.top + tr.height / 2;
  const vw = window.innerWidth; const vh = window.innerHeight;
  const maxD = Math.max(Math.hypot(cx, cy), Math.hypot(vw - cx, cy), Math.hypot(cx, vh - cy), Math.hypot(vw - cx, vh - cy));
  const A = inkSVG(seed, 330, 1, 7, 34);
  const B = inkSVG(seed + 17, 320, 1.25, 9, 26);
  return { cx, cy, vw, vh, maxD, A, B, SA: (2 * maxD) / A.rmin * 1.04, SB: (2 * maxD) / B.rmin * 1.02 };
}

/* Small splash droplets that land ahead of the front and are then swallowed by it. */
function inkDrops(geo, seed) {
  const R = rng(seed + 3);
  const toC = Math.atan2(geo.vh / 2 - geo.cy, geo.vw / 2 - geo.cx);
  const frontAt = (t) => (inkEase(Math.max(0, t)) * geo.SA / 2) * .9;
  return Array.from({ length: INK_DROPS }, (_, k) => {
    const g = inkSVG(seed + 101 + k, 300, 1.5, 4, 8);
    const ang = toC + (R() - .5) * 2.4;
    const dist = geo.maxD * (.14 + R() * .62);
    const size = (26 + R() * R() * 120) / g.rmin;
    let t = 0;
    while (t < 1 && frontAt(t) < dist) t += .01;
    return { g, x: geo.cx + Math.cos(ang) * dist, y: geo.cy + Math.sin(ang) * dist, size, t0: Math.max(.02, t - .24) };
  });
}

function dropScale(t, t0) {
  const u = (t - t0) / .12;
  if (u <= 0) return 0;
  if (u < 1) return (1 - (1 - u) ** 3) * 1.12;
  return 1.12 - Math.min(.12, (u - 1) * .1) + Math.max(0, t - t0 - .12) * .35;
}

function inkFrame(t, geo, drops) {
  const sizes = []; const pos = [];
  const add = (z, x, y) => { sizes.push(`${z.toFixed(1)}px ${z.toFixed(1)}px`); pos.push(`${(x - z / 2).toFixed(1)}px ${(y - z / 2).toFixed(1)}px`); };
  add(inkEase(t) * geo.SA, geo.cx, geo.cy);
  add(inkEase(Math.max(0, (t - .05) / .95)) * geo.SB, geo.cx, geo.cy);
  drops.forEach((dp) => add(dp.size * dropScale(t, dp.t0), dp.x, dp.y));
  const size = sizes.join(','); const position = pos.join(',');
  return { maskSize: size, maskPosition: position, webkitMaskSize: size, webkitMaskPosition: position };
}

function setInkStyle(layers) {
  const urls = layers.map((l) => l.url).join(',');
  let styleEl = document.getElementById('bl-ink-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'bl-ink-style';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `html.ink-run::view-transition-new(root){-webkit-mask-image:${urls};mask-image:${urls};}`;
}

function startInkTransition(next, frames) {
  root.classList.add('ink-run');
  let vt;
  try {
    vt = document.startViewTransition(() => applyTheme(next));
  } catch (err) {
    applyTheme(next); // the browser refused the transition: switch the theme without the splash
    root.classList.remove('ink-run');
    inkBusy = false;
    return;
  }
  vt.ready.then(() => {
    root.animate(frames, { duration: INK_MS, easing: 'linear', fill: 'both', pseudoElement: '::view-transition-new(root)' });
  }).catch(() => { /* transition skipped by the browser: the theme is already applied */ });
  vt.finished.finally(() => { root.classList.remove('ink-run'); inkBusy = false; });
}

function runInk(next, btn) {
  inkBusy = true;
  const seed = Math.floor(Math.random() * 1e6);
  const geo = inkGeometry(seed, btn);
  const drops = inkDrops(geo, seed);
  setInkStyle([geo.A, geo.B, ...drops.map((d) => d.g)]);
  const frames = [];
  for (let s = 0; s <= INK_STEPS; s += 1) frames.push(inkFrame(s / INK_STEPS, geo, drops));
  startInkTransition(next, frames);
}

function toggleTheme(btn) {
  if (inkBusy) return;
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  if (!document.startViewTransition) {
    root.classList.add('theme-fade');
    applyTheme(next);
    setTimeout(() => root.classList.remove('theme-fade'), 500);
    return;
  }
  if (isReduced() || !btn) {
    root.classList.add('vt-fade');
    const fade = document.startViewTransition(() => applyTheme(next));
    fade.finished.finally(() => root.classList.remove('vt-fade'));
    return;
  }
  runInk(next, btn);
}
