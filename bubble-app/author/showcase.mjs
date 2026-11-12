// The author dashboard's showcase: the "Your shelf" hero, KPI life, ledger touches, cover thumbnails
// and letter-style statements. It adds TWO Bubble HTML elements and touches no native element's data:
//   - db_shelf  (inside db_hdr, under the welcome line): the shelf's fixed-height static markup;
//   - db_scene  (top level, after the theme layer): every CSS rule and the one page script.
// All numbers are read from the elements Bubble already renders (KPI tiles, royalty table rows), so
// the shelf, meters and bars always match the table. The book art is the login page's own
// (bubble-app/login/scene/js/03-spines.js and its CSS), reused as is, never copied by hand.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { html, withHtmlId } from '../admin/ui.mjs';

export const SCENE_DIR = new URL('./scene/', import.meta.url);
const LOGIN_SCENE = new URL('../login/scene/', import.meta.url);
/** Spine/cover fonts the theme layer does not load (Fraunces and Manrope come from the theme). */
export const ART_FONTS_URL = 'https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=Oswald:wght@500&display=swap';

export const SHELF_KEY = 'db_shelf';
export const SHELF_HTML_ID = 'bl-author-shelf';
export const SHELF_HEIGHT = 212;
export const SCENE_KEY = 'db_scene';
export const SCENE_HTML_ID = 'bl-author-scene';
export const SCENE_ORDER = 6;
/** The shelf goes last in the header column (welcome 1, "Statuses as of" 2). */
export const SHELF_ORDER = 3;

/** Layout-only changes for the showcase, per Bubble element id. */
export const SHOWCASE_LAYOUT = {
  // Two book cards per row leave room for the cover thumbnail (three were 372 px wide).
  db_bk_rg: { columns: 2 },
  // Status badges sit in the middle of their column, under a centred heading.
  db_rt_tbl_w_status_cell: { container_horiz_alignment: 'center' },
  db_rt_tbl_w_h_status: { font_alignment: 'center' },
};

/** A scene sub-folder's files with one extension, in name order. */
export function sceneFiles(sub, ext) {
  const dir = new URL(`./${sub}/`, SCENE_DIR);
  if (!existsSync(dir)) throw new Error(`Scene folder missing: bubble-app/author/scene/${sub}/`);
  const names = readdirSync(dir).filter((n) => n.endsWith(ext)).sort();
  if (names.length === 0) throw new Error(`No ${ext} files in bubble-app/author/scene/${sub}/`);
  return names.map((name) => ({ name, source: readFileSync(new URL(name, dir), 'utf8') }));
}

/** Top-level `selector { body }` rules of a stylesheet (the login CSS has no nesting outside @keyframes). */
export function cssRules(css) {
  const rules = [];
  let depth = 0; let start = 0; let sel = '';
  for (let i = 0; i < css.length; i += 1) {
    if (css[i] === '{') { if (depth === 0) { sel = css.slice(start, i).replace(/\/\*[\s\S]*?\*\//g, '').trim(); start = i + 1; } depth += 1; }
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) { rules.push({ selector: sel, body: css.slice(start, i).trim() }); start = i + 1; }
    }
  }
  return rules;
}

const loginCss = (name) => readFileSync(new URL(`css/${name}`, LOGIN_SCENE), 'utf8');

/** The login's spine and cover art rules, re-scoped to the author shelf and the book thumbnails. */
export function artCss() {
  const spines = cssRules(loginCss('03-shelf.css')).filter((r) => r.selector.startsWith(':is(#bl-scene, #stage) .sp-'))
    .map((r) => `${r.selector.replaceAll(':is(#bl-scene, #stage)', ':is(.bl-shelf, .bl-thumb)')} { ${r.body} }`);
  const covers = cssRules(loginCss('04-stage.css')).filter((r) => /^#stage \.c(over|v-)/.test(r.selector))
    .map((r) => `${r.selector.replaceAll('#stage ', ':is(.bl-shelf, .bl-thumb) ')} { ${r.body} }`);
  if (spines.length < 10 || covers.length < 10) throw new Error('Login art CSS not found; check bubble-app/login/scene/css/');
  return [...spines, ...covers].join('\n');
}

/** The login's catalogue and art functions (BOOKS, MOTIFS, coverHTML, spineArtHTML, PLANT_SVG). */
export function artJs() {
  const src = readFileSync(new URL('js/03-spines.js', LOGIN_SCENE), 'utf8');
  for (const name of ['const BOOKS', 'function coverHTML', 'function spineArtHTML', 'const PLANT_SVG']) {
    if (!src.includes(name)) throw new Error(`Login art script has no ${name}`);
  }
  return src.trim();
}

export const showcaseCss = () => [
  ...sceneFiles('css', '.css').map((f) => `/* ${f.name} */\n${f.source.trim()}`),
  `/* login art (re-scoped) */\n${artCss()}`,
].join('\n');

/** Author JS files in name order with the login art spliced in after 02-data.js (it needs esc and rng). */
export function showcaseJs() {
  const files = sceneFiles('js', '.js');
  const at = files.findIndex((f) => f.name.startsWith('03'));
  const art = { name: 'login 03-spines.js', source: artJs() };
  const all = [...files.slice(0, at), art, ...files.slice(at)];
  return all.map((f) => `/* ${f.name} */\n${f.source.trim()}`).join('\n');
}

/** The db_scene content: art fonts, the CSS, and one script that runs once per page view. */
export function sceneHtml() {
  return [
    `<link href="${ART_FONTS_URL}" rel="stylesheet">`,
    `<style>\n${showcaseCss()}\n</style>`,
    `<script>\n(function () {\n  'use strict';\n  if (window.__blAuthorScene) return;\n  window.__blAuthorScene = true;\n${showcaseJs()}\n})();\n</script>`,
  ].join('\n');
}

/** The db_shelf content: a fixed-height frame the script fills (so nothing moves when books arrive). */
export const shelfMarkup = () => readFileSync(new URL('./shelf.html', SCENE_DIR), 'utf8').trim();

const zero = { fit_height: false, height: 0, min_width_css: '0px', min_height_css: '0px', max_height_css: '0px' };

export function sceneElement(content = sceneHtml()) {
  return withHtmlId({ ...html(SCENE_KEY, content, { ...zero, order: SCENE_ORDER }), name: 'Author Scene' }, SCENE_HTML_ID);
}

export function shelfElement(content = shelfMarkup()) {
  const px = `${SHELF_HEIGHT}px`;
  const props = { order: SHELF_ORDER, fit_height: false, height: SHELF_HEIGHT, min_height_css: px, max_height_css: px, min_width_css: '0px' };
  return withHtmlId({ ...html(SHELF_KEY, content, props), name: 'Your Shelf' }, SHELF_HTML_ID);
}

/** Applies SHOWCASE_LAYOUT to an element tree (layout keys only; everything else is kept). */
export function relayout(element) {
  if (!element || typeof element !== 'object' || !element.type) return element;
  const extra = SHOWCASE_LAYOUT[element.id];
  const next = extra ? { ...element, properties: { ...element.properties, ...extra } } : element;
  if (!element.elements) return next;
  const kids = Object.entries(element.elements).map(([k, c]) => [k, relayout(c)]);
  return { ...next, elements: Object.fromEntries(kids) };
}

/** db_main with the shelf placed last in db_hdr (replaces a shelf already there). */
export function withShelf(main, shelf = shelfElement()) {
  const hdr = Object.entries(main.elements).find(([, e]) => e?.id === 'db_hdr');
  if (!hdr) throw new Error('db_main has no db_hdr; shelf not placed');
  const hdrNext = { ...hdr[1], elements: { ...hdr[1].elements, [SHELF_KEY]: shelf } };
  return { ...main, elements: { ...main.elements, [hdr[0]]: hdrNext } };
}

/** The page with the showcase: db_main re-laid-out + shelf, and the scene element at the end. */
export function withShowcase(page, { mainKey = 'bTGMp' } = {}) {
  const main = page.elements[mainKey];
  if (main?.id !== 'db_main') throw new Error(`Page has no db_main at ${mainKey}; showcase not added`);
  const elements = { ...page.elements, [mainKey]: withShelf(relayout(main)), [SCENE_KEY]: sceneElement() };
  return { ...page, elements };
}
