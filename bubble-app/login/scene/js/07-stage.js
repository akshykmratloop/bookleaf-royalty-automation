/* 07 — the 3D book: rises off the shelf, flies to its target turning spine→cover, opens on its hinge.
   Closing (Esc, backdrop, "Put back") plays it in reverse. Reduced motion / no GSAP: opens instantly. */
const PERSPECTIVE = 1800;
let openState = null;

function bookDims() {
  const H = Math.round(Math.min(430, window.innerHeight * .62, (window.innerWidth - 36) / 1.42));
  return { H, W: Math.round(H * .7) };
}

function makeBook(b, spineEl, rightHTML) {
  const { W, H } = bookDims();
  const sr = spineEl.getBoundingClientRect();
  const D3 = Math.max(18, Math.round(sr.width * H / Math.max(1, sr.height)));
  const el = document.createElement('div');
  el.className = W < 240 ? 'b3d compact' : 'b3d';
  el.style.cssText = `--W:${W}px;--H:${H}px;--D:${D3}px;--c1:${b.c1};--c2:${b.c2}`;
  el.innerHTML = `
    <div class="face f-back"></div>
    <div class="face f-top"></div><div class="face f-bot"></div>
    <div class="face f-fore"></div>
    <div class="face f-spine">${spineArtHTML(b)}</div>
    <div class="face f-page">${rightHTML}</div>
    <div class="hinge"><div class="face c-out">${coverHTML(b)}</div><div class="face c-in">${leftPageHTML(b)}</div></div>`;
  D.stage.appendChild(el);
  return { el, hinge: el.querySelector('.hinge'), W, H, D: D3, sr };
}

/* Place the book so its spine face projects exactly onto the shelf spine. */
function spineStart(bk) {
  const ox = window.innerWidth / 2; const oy = window.innerHeight / 2;
  const sx = bk.sr.left + bk.sr.width / 2; const sy = bk.sr.top + bk.sr.height / 2;
  let s = bk.sr.height / bk.H;
  let mag = 1;
  for (let k = 0; k < 3; k += 1) {
    mag = PERSPECTIVE / (PERSPECTIVE - (bk.W / 2) * s);
    s = bk.sr.height / (bk.H * mag);
  }
  return { x: ox + (sx - ox) / mag - bk.W / 2, y: oy + (sy - oy) / mag - bk.H / 2, s };
}

/* Take every copy of a book off the shelf, or drop it back in (the CSS .back-in class animates it). */
function hideCopies(i, on) {
  qsa(`.spine[data-i="${i}"]`, D.track).forEach((el) => {
    el.classList.toggle('out', on);
    if (on || isReduced()) return;
    el.style.animation = ''; // clear the entrance's inline "none" so the class animation can run
    el.classList.remove('back-in');
    void el.offsetWidth; // force a reflow so the drop-in replays
    el.classList.add('back-in');
  });
}

function placeShadow(bk, target, sc) {
  if (!D.bkShadow) return;
  gsap.set(D.bkShadow, { width: bk.W * 2 * sc * 1.05, height: 40 * sc, x: target.cx - bk.W * sc * 1.05, y: target.cy + (bk.H * sc) / 2 - 14 * sc });
}

function buildOpenTimeline(bk, target, sc, withBackdrop) {
  const st = spineStart(bk);
  gsap.set(bk.el, { x: st.x, y: st.y, scale: st.s, rotationY: 90, rotationX: 0, transformOrigin: '50% 50%' });
  gsap.set(bk.hinge, { z: bk.D / 2, rotationY: 0, transformOrigin: '0% 50%' });
  const endX = target.cx - bk.W / 2; const endY = target.cy - bk.H / 2;
  const tl = gsap.timeline({ paused: true });
  if (withBackdrop && D.backdrop) tl.to(D.backdrop, { opacity: 1, duration: .5, ease: 'power1.out' }, 0);
  tl.to(bk.el, { y: st.y - 30 * (st.s + .2), scale: st.s * 1.06, duration: .3, ease: 'power2.out' }, 0)
    .to(bk.el, { x: endX, y: endY, scale: sc, rotationY: 0, duration: .9, ease: 'power3.inOut' }, .26)
    .to(bk.el, { keyframes: [{ rotationX: 9, rotationZ: -2, duration: .45, ease: 'sine.out' }, { rotationX: 0, rotationZ: 0, duration: .45, ease: 'sine.inOut' }] }, .26)
    .to(bk.hinge, { rotationY: -178, duration: .95, ease: 'power2.inOut' }, 1.08)
    .to(bk.el, { x: endX + (bk.W * sc) / 2, duration: .95, ease: 'power2.inOut' }, 1.08);
  if (D.bkShadow) tl.fromTo(D.bkShadow, { opacity: 0 }, { opacity: .8, duration: .8 }, .8);
  placeShadow(bk, target, sc);
  return tl;
}

/* While the book is open, the rest of the scene and the native card are inert (the stage is not). */
function setSceneInert(on) {
  const targets = [D.scene ? qs('.shell', D.scene) : null, byId('bl-card')];
  targets.forEach((el) => {
    if (!el || el.contains(D.stage)) return;
    if (on) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  });
}

function openInstant(bk, target) {
  bk.el.style.transform = `translate(${target.cx}px, ${target.cy - bk.H / 2}px)`;
  bk.hinge.style.transform = `translateZ(${bk.D / 2}px) rotateY(-178deg)`;
  bk.hinge.style.transformOrigin = '0 50%';
  if (D.backdrop) D.backdrop.style.opacity = 1;
  if (D.bkClose) D.bkClose.style.opacity = 1;
  return null;
}

function openAnimated(bk, target) {
  const tl = buildOpenTimeline(bk, target, 1, true);
  if (D.bkClose) tl.to(D.bkClose, { opacity: 1, duration: .3 }, 1.4);
  const barEls = bk.el.querySelectorAll('.bars span');
  if (barEls.length) tl.from(barEls, { scaleY: 0, stagger: .06, duration: .5, ease: 'back.out(1.6)' }, 1.7);
  tl.play();
  return tl;
}

function openBook(spineEl) {
  const b = spineEl ? BOOKS[+spineEl.dataset.i] : null;
  if (!b || openState || S.busy || S.closing) return;
  hideTip();
  S.modal = true; S.v = 0; S.lastBook = b.i;
  const returnTo = spineEl.matches(':focus-visible') ? realSpines[b.i] || null : null;
  D.stage.classList.add('on', 'modal');
  D.stage.setAttribute('aria-hidden', 'false');
  setSceneInert(true);
  const bk = makeBook(b, spineEl, rightPageHTML(b));
  const target = { cx: window.innerWidth / 2, cy: window.innerHeight / 2 };
  hideCopies(b.i, true);
  const tl = (!hasGsap() || isReduced()) ? openInstant(bk, target) : openAnimated(bk, target);
  openState = { bk, tl, b, returnTo };
  setTimeout(() => { if (D.bkClose) D.bkClose.focus({ preventScroll: true }); }, 30);
}

function finishClose(state, then) {
  S.closing = false;
  state.bk.el.remove();
  D.stage.classList.remove('on', 'modal');
  D.stage.setAttribute('aria-hidden', 'true');
  if (D.backdrop) D.backdrop.style.opacity = 0;
  if (D.bkClose) D.bkClose.style.opacity = 0;
  if (hasGsap() && D.bkShadow) gsap.set(D.bkShadow, { opacity: 0 });
  setSceneInert(false);
  hideCopies(state.b.i, false);
  S.modal = false;
  if (typeof then === 'function') then();
  else if (state.returnTo) state.returnTo.focus({ preventScroll: true });
  else if (document.activeElement) document.activeElement.blur();
}

function closeBook(then) {
  if (!openState) return;
  const state = openState;
  openState = null;
  S.closing = true;
  if (!state.tl || state.tl.progress() === 0) { finishClose(state, then); return; }
  state.tl.eventCallback('onReverseComplete', () => finishClose(state, then));
  state.tl.timeScale(1.5).reverse();
}

function focusEmail() {
  const email = byId('bl-email');
  if (email) email.focus();
}

function onStageKey(e) {
  if (!openState) return;
  if (e.key === 'Escape') { e.preventDefault(); closeBook(); return; }
  if (e.key !== 'Tab') return;
  const f = [D.bkClose, ...qsa('[data-cta]', D.stage)].filter(Boolean);
  if (!f.length) return;
  e.preventDefault();
  const i = f.indexOf(document.activeElement);
  f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
}

function bindStage() {
  if (D.bkClose) D.bkClose.addEventListener('click', () => closeBook());
  if (D.backdrop) D.backdrop.addEventListener('click', () => closeBook());
  D.stage.addEventListener('click', (e) => {
    if (e.target.closest('[data-cta]')) { closeBook(focusEmail); return; }
    if (e.target === D.stage) closeBook();
  });
  document.addEventListener('keydown', onStageKey);
}
