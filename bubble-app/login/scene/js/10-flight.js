/* 10 — sign-in flow around the native card: a book flies from the shelf into the card while Bubble
   logs in; the demo buttons get a cosmetic typewriter; a Bubble error puts the book back and shakes
   the card. Bubble's own click handlers always run: nothing here prevents default or submits. */
const DEMO_LOGINS = { author: 'priya.sharma@email.com', admin: 'admin@bookleaf.demo' };
const DEMO_PW_STAND_IN = '••••••••••••'; // masked stand-in: the real demo password never appears here
const FLIGHT_TIMEOUT_MS = 15000;
const ERR_RECHECK_MS = 450;
const SHAKE_MS = 600;
const TYPE_EMAIL_MS = 18;
const TYPE_PW_MS = 22;
const F = { tl: null, bk: null, b: null, timer: 0, typing: false, errShown: false, emptyTimer: 0, lastShake: 0 };

const fieldsFilled = () => !!(NB.email && NB.pw && NB.email.value.trim() && NB.pw.value);

function whoFromEmail() {
  const value = NB.email ? NB.email.value.trim().toLowerCase() : '';
  if (value === DEMO_LOGINS.admin) return 'admin';
  return value === DEMO_LOGINS.author ? 'author' : null;
}

function visibleSpines() {
  if (!SCENE_OK) return [];
  const vr = D.vp.getBoundingClientRect();
  if (vr.bottom < 0 || vr.top > window.innerHeight || vr.width < 1) return [];
  return qsa('.spine', D.track).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.left > vr.left + 30 && r.right < vr.right - 60 && !el.classList.contains('out');
  });
}

/* The last book opened if it is in view, else a random published one. */
function pickFlightSpine() {
  const vis = visibleSpines();
  const last = vis.find((el) => +el.dataset.i === S.lastBook);
  if (last) return last;
  const pub = vis.filter((el) => !isProd(BOOKS[+el.dataset.i]));
  return pub[Math.floor(Math.random() * pub.length)] || vis[0] || null;
}

function canFly() {
  if (F.bk || !SCENE_OK || !NB.card || !hasGsap() || isReduced() || openState || S.closing) return false;
  const rect = NB.card.getBoundingClientRect();
  return rect.width >= 1 && rect.bottom >= 0 && rect.top <= window.innerHeight;
}

function flyToCard(who) {
  if (!canFly()) return;
  const spineEl = pickFlightSpine();
  if (!spineEl) return;
  const b = BOOKS[+spineEl.dataset.i];
  const rect = NB.card.getBoundingClientRect();
  hideTip();
  S.paused = true; S.busy = true; S.v = 0;
  D.stage.classList.add('on');
  const bk = makeBook(b, spineEl, welcomePageHTML(b, who));
  const sc = Math.min(1, (rect.width * .98) / (bk.W * 2), (rect.height * .8) / bk.H);
  hideCopies(b.i, true);
  NB.card.classList.add('bl-dim');
  const tl = buildOpenTimeline(bk, { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 }, sc, false);
  Object.assign(F, { tl, bk, b, timer: setTimeout(landBook, FLIGHT_TIMEOUT_MS) });
  tl.play();
}

function finishLanding(bk, b) {
  bk.el.remove();
  D.stage.classList.remove('on');
  if (D.bkShadow) gsap.set(D.bkShadow, { opacity: 0 });
  hideCopies(b.i, false);
  S.paused = false; S.busy = false;
  if (F.bk === bk) { F.bk = null; F.b = null; }
}

/* Put the flying book back on the shelf (Bubble reported an error, or nothing happened in time). */
function landBook() {
  clearTimeout(F.timer);
  F.timer = 0;
  const { tl, bk, b } = F;
  if (!tl || !bk) return;
  F.tl = null;
  if (NB.card) NB.card.classList.remove('bl-dim');
  if (tl.progress() === 0) { finishLanding(bk, b); return; }
  tl.eventCallback('onReverseComplete', () => finishLanding(bk, b));
  tl.timeScale(1.5).reverse();
}

function onSignInIntent() {
  if (F.typing) return;
  if (!fieldsFilled()) { scheduleEmptyCheck(); return; }
  flyToCard(whoFromEmail());
}

function setInputValue(inp, value) {
  inp.value = value;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
}

async function typeInto(inp, text, perChar) {
  setInputValue(inp, '');
  for (const ch of text) {
    setInputValue(inp, inp.value + ch);
    await wait(perChar + Math.random() * perChar * .6);
  }
}

async function typeDemo(kind) {
  setPwVisible(false);
  if (isReduced()) {
    setInputValue(NB.email, DEMO_LOGINS[kind]);
    if (NB.pw) setInputValue(NB.pw, DEMO_PW_STAND_IN);
    return;
  }
  await typeInto(NB.email, DEMO_LOGINS[kind], TYPE_EMAIL_MS);
  if (NB.pw) await typeInto(NB.pw, DEMO_PW_STAND_IN, TYPE_PW_MS);
}

/* Cosmetic only: Bubble's demo workflow logs in on its own with its own credentials. */
async function runDemo(kind) {
  if (F.typing || !NB.email) return;
  F.typing = true;
  if (openState) closeBook(() => {});
  clearFieldErrors();
  try {
    await typeDemo(kind);
  } finally {
    F.typing = false;
  }
  flyToCard(kind);
}

/* Bubble only creates #bl-err the first time it is shown, so look it up again whenever it is needed. */
function errVisible() {
  if (!NB.err || !NB.err.isConnected) NB.err = byId('bl-err');
  const el = NB.err;
  if (!el || !el.textContent.trim() || !el.getClientRects().length) return false;
  return window.getComputedStyle(el).visibility !== 'hidden';
}

function clearFieldErrors() {
  [[NB.emailF, NB.email], [NB.pwF, NB.pw]].forEach(([group, inp]) => {
    if (group) group.classList.remove('is-error');
    if (inp) inp.removeAttribute('aria-invalid');
  });
}

function markEmptyFields() {
  [[NB.emailF, NB.email], [NB.pwF, NB.pw]].forEach(([group, inp]) => {
    if (!group || !inp) return;
    const empty = inp === NB.email ? !inp.value.trim() : !inp.value;
    group.classList.toggle('is-error', empty);
    if (empty) inp.setAttribute('aria-invalid', 'true');
  });
}

function shakeCard() {
  if (!NB.card) return;
  F.lastShake = performance.now();
  NB.card.classList.remove('bl-shake');
  void NB.card.offsetWidth; // restart the animation
  NB.card.classList.add('bl-shake');
  setTimeout(() => NB.card.classList.remove('bl-shake'), SHAKE_MS);
}

function onBubbleError() {
  landBook();
  shakeCard();
  markEmptyFields();
}

/* An empty submit while the error is already showing gives no new mutation: re-check shortly. */
function scheduleEmptyCheck() {
  clearTimeout(F.emptyTimer);
  F.emptyTimer = setTimeout(() => {
    if (errVisible() && performance.now() - F.lastShake > ERR_RECHECK_MS) onBubbleError();
  }, ERR_RECHECK_MS);
}

function checkErr() {
  const shown = errVisible();
  const rising = shown && !F.errShown;
  F.errShown = shown;
  if (rising) onBubbleError();
}
