/* 11 — start-up: the scene starts at once; the card bridge starts as soon as Bubble has drawn
   #bl-email (MutationObserver + polling, giving up after BRIDGE_WAIT_MS). Runs once per page. */
const BRIDGE_WAIT_MS = 20000;
const BRIDGE_POLL_MS = 300;
const RESIZE_DEBOUNCE_MS = 80;
let bridgeStarted = false;
let resizeTimer = 0;

/* Bubble creates #bl-err only when it is first shown, then hides/shows it by style (it briefly hides
   it at the start of every sign-in attempt). Watch the whole card, where it appears. */
function observeErr() {
  const host = NB.cardMain || NB.card;
  if (!host || typeof MutationObserver === 'undefined') return;
  const mo = new MutationObserver(checkErr);
  mo.observe(host, { attributes: true, attributeFilter: ['style', 'class', 'hidden'], childList: true, characterData: true, subtree: true });
  F.errShown = errVisible();
}

function bindSignIn() {
  if (NB.signin) {
    NB.signin.addEventListener('pointerdown', (e) => { if (e.button === 0) onSignInIntent(); });
    NB.signin.addEventListener('click', onSignInIntent);
  }
  if (NB.pw) NB.pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSignInIntent(); });
  if (NB.demoAuthor) NB.demoAuthor.addEventListener('click', () => { runDemo('author'); });
  if (NB.demoAdmin) NB.demoAdmin.addEventListener('click', () => { runDemo('admin'); });
}

function tryStartBridge() {
  if (bridgeStarted) return true;
  if (!byId('bl-email')) return false;
  bridgeStarted = true;
  lookupNative();
  blankPlaceholders();
  injectGreet();
  injectIcon(NB.emailF, 'mail', ICON_MAIL);
  injectIcon(NB.pwF, 'lock', ICON_LOCK);
  injectPwToggle();
  injectSheen();
  bindFilled();
  bindCardFx();
  bindSignIn();
  observeErr();
  return true;
}

function waitForBridge() {
  if (tryStartBridge()) return;
  const target = document.body || root;
  const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => { if (tryStartBridge()) stop(); });
  if (mo) mo.observe(target, { childList: true, subtree: true });
  const poll = setInterval(() => { if (tryStartBridge()) stop(); }, BRIDGE_POLL_MS);
  const giveUp = setTimeout(stop, BRIDGE_WAIT_MS);
  function stop() {
    if (mo) mo.disconnect();
    clearInterval(poll);
    clearTimeout(giveUp);
  }
}

function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(measure, RESIZE_DEBOUNCE_MS);
}

function initScene() {
  if (D.toggle) D.toggle.addEventListener('click', toggleTheme);
  themeLabel();
  if (!SCENE_OK) return;
  buildShelf();
  bindShelf();
  bindShelfUi();
  bindStage();
  bindAmbient();
  window.addEventListener('resize', onResize);
  measure();
  staggerEntrance();
  startLoop();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
}

function bootLogin() {
  if (window.__blLoginBooted) return;
  window.__blLoginBooted = true;
  try {
    initScene();
  } finally {
    waitForBridge(); // the sign-in card effects start even if the scene failed (the error still surfaces)
  }
}

bootLogin();
