// Joins the Living Bookshelf scene (bubble-app/login/scene/) into the content of one Bubble HTML
// element: fonts, all CSS (file-name order), the markup, then one script that loads GSAP from cdnjs
// and runs all scene JS (file-name order) inside a single IIFE once the native Bubble card is on the page.
import { readdirSync, readFileSync, existsSync } from 'node:fs';

export const SCENE_DIR = new URL('./scene/', import.meta.url);
export const GSAP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/gsap.min.js';
export const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Fraunces:ital,opsz,wght@0,9..144,300..800;1,9..144,300..700&family=Manrope:wght@300..800&family=Oswald:wght@400..600&display=swap';
/** Theme storage key, shared with the scene's theme switch. */
export const THEME_KEY = 'bl-login-theme';
/** How long the boot waits for GSAP and the native card before running anyway (ms). */
export const BOOT_TIMEOUT_MS = 4000;

const FONTS = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  `<link href="${FONTS_URL}" rel="stylesheet">`,
].join('\n');

/** Sets data-theme on <html> before anything draws: saved choice, else the system setting. */
const THEME_INIT = `<script>(function(){var t=null;try{t=localStorage.getItem('${THEME_KEY}');}catch(e){t=null;}
if(t!=='light'&&t!=='dark'){t=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
document.documentElement.setAttribute('data-theme',t);})();</script>`;

/** Lists a scene sub-folder's files with one extension, in name order. */
export function sceneFiles(sub, ext) {
  const dir = new URL(`./${sub}/`, SCENE_DIR);
  if (!existsSync(dir)) throw new Error(`Scene folder missing: bubble-app/login/scene/${sub}/`);
  const names = readdirSync(dir).filter((n) => n.endsWith(ext)).sort();
  if (names.length === 0) throw new Error(`No ${ext} files in bubble-app/login/scene/${sub}/`);
  return names.map((name) => ({ name, path: new URL(name, dir), source: readFileSync(new URL(name, dir), 'utf8') }));
}

export const sceneCss = () => sceneFiles('css', '.css').map((f) => `/* ${f.name} */\n${f.source.trim()}`).join('\n');
export const sceneJs = () => sceneFiles('js', '.js').map((f) => `/* ${f.name} */\n${f.source.trim()}`).join('\n');
export const sceneMarkup = () => readFileSync(new URL('./markup.html', SCENE_DIR), 'utf8').trim();

/**
 * The scene script. Runs once per page view: after GSAP has loaded (or failed, or timed out, so a
 * blocked CDN never blocks the page) and after Bubble has drawn the native inputs.
 */
export function bootScript(js) {
  return `<script>
(function () {
  'use strict';
  if (window.__blLoginScene) return;
  window.__blLoginScene = true;
  var started = Date.now();
  function scene() {
${js}
  }
  function ready() {
    var late = Date.now() - started > ${BOOT_TIMEOUT_MS};
    var card = document.getElementById('bl-email') && document.getElementById('bl-scene');
    if ((window.gsap && card) || late) { scene(); return; }
    setTimeout(ready, 40);
  }
  if (window.gsap) { ready(); return; }
  var s = document.createElement('script');
  s.src = '${GSAP_URL}';
  s.async = true;
  document.head.appendChild(s);
  ready();
})();
</script>`;
}

/** The full HTML element content. */
export function buildScene() {
  return [FONTS, THEME_INIT, `<style>\n${sceneCss()}\n</style>`, sceneMarkup(), bootScript(sceneJs())].join('\n');
}
