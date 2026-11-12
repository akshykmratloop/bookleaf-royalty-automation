/* 09 — bridge to the native Bubble sign-in card: greeting, field icons, eye toggle, filled state,
   magnetic Sign-in button and the card sheen. Cosmetic only: never submits, never blocks Bubble. */
const AUTOFILL_RECHECK_MS = 600;
const MAGNET_REACH_PX = 30;
const NB = {
  card: null, cardMain: null, title: null, emailF: null, email: null, pwF: null, pw: null,
  signin: null, err: null, demoAuthor: null, demoAdmin: null, sheen: null, pwToggle: null,
};

const ICON_LEAF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 12C7 9 9 4 12 3c3 1 5 6 10 9-5 3-7 8-10 9-3-1-5-6-10-9z"/></svg>';
const ICON_MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="3"/><path class="flap" d="m3.5 6.5 8.5 6.5 8.5-6.5"/></svg>';
const ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10.5" width="16" height="10.5" rx="2.6"/><path class="shackle" d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"/><circle cx="12" cy="15.6" r="1.3" fill="currentColor"/></svg>';
const ICON_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path class="slash" d="M4 3.5 20 20.5"/></svg>';

/* Bubble puts the HTML id on the <input> itself; fall back to an inner input just in case. */
function inputById(id) {
  const el = byId(id);
  if (!el) return null;
  return el.tagName === 'INPUT' ? el : el.querySelector('input');
}

function lookupNative() {
  NB.card = byId('bl-card');
  NB.cardMain = byId('bl-card-main');
  NB.title = byId('bl-title');
  NB.emailF = byId('bl-email-f');
  NB.email = inputById('bl-email');
  NB.pwF = byId('bl-pw-f');
  NB.pw = inputById('bl-pw');
  NB.signin = byId('bl-signin');
  NB.err = byId('bl-err');
  NB.demoAuthor = byId('bl-demo-author');
  NB.demoAdmin = byId('bl-demo-admin');
}

function greetingText() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  return h < 17 ? 'Good afternoon' : 'Good evening';
}

function injectGreet() {
  if (!NB.title || !NB.title.parentNode || qs('.bl-greet')) return;
  const p = document.createElement('p');
  p.className = 'bl-greet';
  p.innerHTML = `${ICON_LEAF}<span>${greetingText()}</span>`;
  NB.title.parentNode.insertBefore(p, NB.title);
}

function injectIcon(group, kind, svg) {
  if (!group || qs('.bl-ico', group)) return;
  const span = document.createElement('span');
  span.className = `bl-ico bl-ico-${kind}`;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = svg;
  group.appendChild(span);
}

function setPwVisible(show) {
  if (!NB.pw) return;
  NB.pw.type = show ? 'text' : 'password';
  if (!NB.pwToggle) return;
  NB.pwToggle.setAttribute('aria-pressed', String(show));
  NB.pwToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}

function injectPwToggle() {
  if (!NB.pwF || !NB.pw || byId('pw-toggle')) return;
  const btn = document.createElement('button');
  btn.id = 'pw-toggle';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Show password');
  btn.setAttribute('aria-pressed', 'false');
  btn.setAttribute('aria-controls', NB.pw.id || 'bl-pw');
  btn.innerHTML = ICON_EYE;
  btn.addEventListener('click', () => setPwVisible(NB.pw.type === 'password'));
  NB.pwF.appendChild(btn);
  NB.pwToggle = btn;
}

/* Bubble's own placeholders would collide with the floating labels (:placeholder-shown needs " "). */
function blankPlaceholders() {
  [NB.email, NB.pw].forEach((inp) => { if (inp) inp.setAttribute('placeholder', ' '); });
}

function syncField(group, inp) {
  if (!group || !inp) return;
  const filled = inp.value !== '';
  group.classList.toggle('is-filled', filled);
  if (!filled) return;
  group.classList.remove('is-error');
  inp.removeAttribute('aria-invalid');
}

function syncFilled() {
  syncField(NB.emailF, NB.email);
  syncField(NB.pwF, NB.pw);
}

function bindFilled() {
  [NB.email, NB.pw].forEach((inp) => {
    if (!inp) return;
    inp.addEventListener('input', syncFilled);
    inp.addEventListener('change', syncFilled);
  });
  syncFilled();
  setTimeout(syncFilled, AUTOFILL_RECHECK_MS); // browser autofill does not always fire input
}

/* The CSS styles it as `#bl-card > .bl-sheen`, so it must be the card's own first child. */
function injectSheen() {
  if (!NB.card) return;
  NB.sheen = qs(':scope > .bl-sheen', NB.card);
  if (NB.sheen) return;
  NB.sheen = document.createElement('div');
  NB.sheen.className = 'bl-sheen';
  NB.sheen.setAttribute('aria-hidden', 'true');
  NB.card.insertBefore(NB.sheen, NB.card.firstChild);
}

function magnetize(e) {
  const br = NB.signin.getBoundingClientRect();
  const dx = e.clientX - (br.left + br.width / 2); const dy = e.clientY - (br.top + br.height / 2);
  const near = Math.abs(dx) < br.width / 2 + MAGNET_REACH_PX && Math.abs(dy) < br.height / 2 + MAGNET_REACH_PX;
  gsap.to(NB.signin, { x: near ? dx * .06 : 0, y: near ? dy * .22 : 0, duration: .5, ease: 'power3.out', overwrite: 'auto' });
  const lbl = NB.signin.firstElementChild;
  if (lbl) gsap.to(lbl, { x: near ? dx * .05 : 0, y: near ? dy * .12 : 0, duration: .5, ease: 'power3.out', overwrite: 'auto' });
}

function onCardPointerMove(e) {
  if (NB.sheen) {
    const r = NB.sheen.getBoundingClientRect();
    NB.sheen.style.setProperty('--mx', `${(e.clientX - r.left).toFixed(1)}px`);
    NB.sheen.style.setProperty('--my', `${(e.clientY - r.top).toFixed(1)}px`);
  }
  if (NB.signin && hasGsap() && !isReduced()) magnetize(e);
}

function onCardPointerLeave() {
  if (!NB.signin || !hasGsap()) return;
  const targets = [NB.signin, NB.signin.firstElementChild].filter(Boolean);
  gsap.to(targets, { x: 0, y: 0, duration: .6, ease: 'elastic.out(1, .5)' });
}

function bindCardFx() {
  if (!NB.card) return;
  NB.card.addEventListener('pointermove', onCardPointerMove);
  NB.card.addEventListener('pointerleave', onCardPointerLeave);
}
