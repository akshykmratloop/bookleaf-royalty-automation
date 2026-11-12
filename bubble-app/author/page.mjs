// The author dashboard (Bubble page `dashboard`), as data. `scripts/editor/write-author.mjs` writes it.
// The page was built in the Bubble editor, so there is no generator: this module rebuilds it from the
// live page JSON (snapshot: dashboard-before.json) and changes layout and style properties only:
//   1. alignment fixes (looks.mjs LAYOUT),
//   2. token colours from admin/theme.mjs laid over the design-system styles, so dark mode works,
//   3. HTML ids on the one-off elements, for the shared theme CSS,
//   4. the shared theme layer as one HTML element at the end of the page (see THEME SLOT below),
//      and its sun/moon toggle at the right end of the top bar row.
// Workflows, custom states, page properties, data sources, texts and conditions are copied through.
// It builds from the live page, so running it again on an already-written page changes nothing.
import { readFileSync } from 'node:fs';
import { html, withHtmlId } from '../admin/ui.mjs';
import { STYLE_LOOK, LAYOUT, HTML_IDS, retoken } from './looks.mjs';
import { themeLayer, themeToggleElement } from '../theme/layer.mjs';

// ---- THEME SLOT: the shared theme layer (fonts, light/dark tokens, ink-splash switch) -------------
export const THEME_HTML = themeLayer();
// --------------------------------------------------------------------------------------------------

export const PAGE_ID = 'dashboard';
/** Top-level elements this module rewrites, keyed by their Bubble keys (bar, main, statement popup). */
export const TOP_KEYS = { bTGMo: 'db_bar', bTGMp: 'db_main', bTGMq: 'db_pop' };
/** Key and id of the added theme element (Bubble accepts readable keys, as on the sign-in page). */
export const THEME_KEY = 'db_theme';
export const THEME_HTML_ID = 'bl-author-theme';
/** The sun/moon toggle: a child of the top bar row (db_bar > db_bar_in_pane > db_bar_in), after Log out. */
export const TOGGLE_KEY = 'db_theme_toggle';
export const TOGGLE_ORDER = 5;

/** The page as it was before this redesign (its workflows, states and data are the contract). */
export const BEFORE = JSON.parse(readFileSync(new URL('./dashboard-before.json', import.meta.url), 'utf8'));

/** Style look first, then the element's own properties (colours swapped), then the layout fixes. */
function restyleOne(element) {
  const look = STYLE_LOOK[element.style] ?? {};
  const properties = { ...look, ...retoken(element.properties), ...(LAYOUT[element.id] ?? {}) };
  const next = { ...element, properties };
  if (element.states) next.states = retokenStates(element.states);
  return HTML_IDS[element.id] ? withHtmlId(next, HTML_IDS[element.id]) : next;
}

/** Conditions keep their `condition` exactly; only mapped colours inside `properties` change. */
function retokenStates(states) {
  const swap = ([key, state]) => [key, state && typeof state === 'object' && state.properties
    ? { ...state, properties: retoken(state.properties) } : state];
  return Object.fromEntries(Object.entries(states).map(swap));
}

/** Restyles an element and, recursively, everything inside it. */
export function restyle(element) {
  if (!element || typeof element !== 'object' || !element.type) return element; // `length` keys
  const next = restyleOne(element);
  if (!element.elements) return next;
  const children = Object.entries(element.elements).map(([key, child]) => [key, restyle(child)]);
  return { ...next, elements: Object.fromEntries(children) };
}

/** The theme layer's host: one HTML element after everything else on the page. */
export function themeElement(content = THEME_HTML) {
  const props = { order: 5, fit_height: false, height: 0, min_width_css: '0px', min_height_css: '0px' };
  return withHtmlId({ ...html(THEME_KEY, content, props), name: 'Theme Layer' }, THEME_HTML_ID);
}

/** The top bar with the theme toggle at the end of its row (replaces a toggle already there). */
export function withToggle(bar) {
  const pane = Object.entries(bar.elements).find(([, e]) => e?.id === 'db_bar_in_pane');
  const inner = pane && Object.entries(pane[1].elements).find(([, e]) => e?.id === 'db_bar_in');
  if (!inner) throw new Error('Top bar has no db_bar_in row; theme toggle not placed');
  const toggle = themeToggleElement(TOGGLE_KEY);
  const row = { ...inner[1], elements: { ...inner[1].elements, [TOGGLE_KEY]: { ...toggle, properties: { ...toggle.properties, order: TOGGLE_ORDER } } } };
  const paneNext = { ...pane[1], elements: { ...pane[1].elements, [inner[0]]: row } };
  return { ...bar, elements: { ...bar.elements, [pane[0]]: paneNext } };
}

/** The whole page after the redesign. The writer sends only TOP_KEYS (and THEME_KEY) to Bubble. */
export function buildAuthorPage(live = BEFORE, themeHtml = THEME_HTML) {
  const elements = { ...live.elements };
  for (const [key, id] of Object.entries(TOP_KEYS)) {
    if (elements[key]?.id !== id) throw new Error(`Page ${PAGE_ID} has no ${id} at ${key}; nothing built`);
    elements[key] = restyle(elements[key]);
  }
  if (themeHtml) {
    elements.bTGMo = withToggle(elements.bTGMo);
    elements[THEME_KEY] = themeElement(themeHtml);
  }
  return { ...live, elements };
}
