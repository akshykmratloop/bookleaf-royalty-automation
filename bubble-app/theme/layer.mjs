// The shared theme layer: ONE Bubble HTML element's content that themes a whole page (admin, author
// dashboard, reset_pw, 404). It loads Fraunces + Manrope, defines the light and dark tokens on
// html[data-theme] (theme/css/, name order), points Bubble's own colour/font tokens at them, and runs
// the ink-splash theme switch (theme/js/, name order, inside one IIFE). The theme is stored under the
// login page's key, so a choice made on the login page carries over and back.
import { readdirSync, readFileSync, existsSync } from 'node:fs';

export const THEME_DIR = new URL('./', import.meta.url);
/** Theme storage key, shared with the login page (bubble-app/login/scene.mjs). */
export const THEME_KEY = 'bl-login-theme';
export const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..800;1,9..144,300..700&family=Manrope:wght@300..800&display=swap';

/** CSS variables the chart script can read; they change with the theme (listen for `bl-theme-change`). */
export const CHART_VARS = [
  '--bl-chart-text', '--bl-chart-grid', '--bl-chart-axis', '--bl-chart-paid', '--bl-chart-pending',
  '--bl-chart-sent', '--bl-chart-failed', '--bl-chart-draft', '--bl-chart-progress', '--bl-chart-discarded',
  '--bl-chart-track', '--bl-chart-shimmer', '--bl-chart-tooltip-bg', '--bl-chart-tooltip-text', '--bl-font-ui',
];

const FONTS = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  `<link href="${FONTS_URL}" rel="stylesheet">`,
].join('\n');

/** Sets data-theme on <html> straight away (also safe to put in a page's HTML header). */
export const THEME_INIT = `<script>(function(){var t=null;try{t=localStorage.getItem('${THEME_KEY}');}catch(e){t=null;}
if(t!=='light'&&t!=='dark'){t=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
document.documentElement.setAttribute('data-theme',t);})();</script>`;

/** The sun/moon toggle drawing (same as the login page's). */
export function toggleMarkup({ floating = false } = {}) {
  const cls = floating ? 'bl-theme-toggle is-floating' : 'bl-theme-toggle';
  return `<button type="button" class="${cls}" data-bl-theme-toggle aria-label="Switch between light and dark theme" aria-pressed="false">
<svg viewBox="0 0 24 24" aria-hidden="true">
<defs><mask id="bl-tg-mask"><rect x="-6" y="-6" width="36" height="36" fill="#fff"/><circle class="tg-bite" cx="17" cy="7" r="7.5" fill="#000"/></mask></defs>
<circle class="tg-core" cx="12" cy="12" r="5" fill="currentColor" mask="url(#bl-tg-mask)"/>
<g class="tg-rays" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 1.5v2.2M12 20.3v2.2M1.5 12h2.2M20.3 12h2.2M4.6 4.6l1.5 1.5M17.9 17.9l1.5 1.5M4.6 19.4l1.5-1.5M17.9 6.1l1.5-1.5"/></g>
</svg></button>`;
}

/** Lists a theme sub-folder's files with one extension, in name order. */
export function themeFiles(sub, ext) {
  const dir = new URL(`./${sub}/`, THEME_DIR);
  if (!existsSync(dir)) throw new Error(`Theme folder missing: bubble-app/theme/${sub}/`);
  const names = readdirSync(dir).filter((n) => n.endsWith(ext)).sort();
  if (names.length === 0) throw new Error(`No ${ext} files in bubble-app/theme/${sub}/`);
  return names.map((name) => ({ name, source: readFileSync(new URL(name, dir), 'utf8') }));
}

export const themeCss = () => themeFiles('css', '.css').map((f) => `/* ${f.name} */\n${f.source.trim()}`).join('\n');
export const themeJs = () => themeFiles('js', '.js')
  .map((f) => `/* ${f.name} */\n${f.source.trim()}`).join('\n')
  .replaceAll('__BL_THEME_KEY__', THEME_KEY);

/** Runs the theme script once per page view, however often Bubble re-renders the element. */
function bootScript(js) {
  return `<script>
(function () {
  'use strict';
  if (window.__blThemeLayer) return;
  window.__blThemeLayer = true;
${js}
})();
</script>`;
}

/**
 * The full HTML element content (a string). `floatingToggle` adds a fixed sun/moon button in the
 * top-right corner, for pages with no top bar of their own (reset_pw, 404).
 */
export function themeLayer({ floatingToggle = false } = {}) {
  const parts = [FONTS, THEME_INIT, `<style>\n${themeCss()}\n</style>`];
  if (floatingToggle) parts.push(toggleMarkup({ floating: true }));
  parts.push(bootScript(themeJs()));
  return parts.join('\n');
}
export const themeHtml = themeLayer;

const htmlElement = (id, content, props) => ({
  type: 'HTML', id, default_name: `HTML ${id}`, name: id,
  properties: { html: content, fit_height: false, min_width_css: '0px', min_height_css: '0px', ...props },
});

/** The theme layer as a Bubble HTML element that takes no room (put it first on the page). */
export const themeLayerElement = (id = 'bl_theme', opts = {}) =>
  htmlElement(id, themeLayer(opts), { height: 0, width: 0, max_height_css: '0px', min_width_css: '0px' });

/** A 40 × 40 HTML element holding the sun/moon toggle, for a top bar row. */
export const themeToggleElement = (id = 'bl_theme_toggle') =>
  htmlElement(id, `<div class="bl-toggle-slot">${toggleMarkup()}</div>`, {
    width: 40, height: 40, single_width: true, single_height: true, fit_width: false,
    min_width_css: '40px', max_width_css: '40px', min_height_css: '40px', vert_alignment: 'center',
  });
