// The sign-in page (`index`, Bubble id bTGYf), as data. `scripts/editor/write-login.mjs` writes it.
// The sign-in itself stays native Bubble: inputs, buttons, the error text, all 8 workflows and both
// custom states are kept exactly. This module only:
//   1. gives the native elements HTML ids (so the scene's CSS and JS can find them),
//   2. swaps the old left panel (`ix_left`) for one HTML element, `ix_scene` (the Living Bookshelf),
//   3. sets the card's two texts and the layout properties.
// It builds from the live page JSON, so running it again on an already-written page changes nothing.
import { readFileSync } from 'node:fs';
import { html, withHtmlId } from '../admin/ui.mjs';
import { text } from '../admin/expr.mjs';
import { buildScene } from './scene.mjs';

export const PAGE_ID = 'bTGYf';
/** The page's one top-level element (`ix_split`), keyed by its Bubble key. */
export const SPLIT_KEY = 'bTGMz';
export const SCENE_ID = 'ix_scene';
/** Elements removed from the page (the old left panel and everything inside it). */
export const REMOVED_KEYS = ['ix_left'];

/** Bubble element id -> HTML id (Bubble's `unique_id`). Inputs get it on the <input> itself. */
export const HTML_IDS = {
  ix_split: 'bl-split', ix_right: 'bl-right', ix_form: 'bl-card', ix_card: 'bl-card-main',
  ix_title: 'bl-title', ix_sub: 'bl-sub',
  ix_email_f: 'bl-email-f', ix_email_l: 'bl-email-l', ix_email: 'bl-email',
  ix_pw_f: 'bl-pw-f', ix_pw_l: 'bl-pw-l', ix_pw: 'bl-pw',
  ix_signin: 'bl-signin', ix_err: 'bl-err',
  ix_demo: 'bl-demo', ix_demo_t: 'bl-demo-t', ix_demo_s: 'bl-demo-s', ix_demo_btns: 'bl-demo-btns',
  ix_demo_author: 'bl-demo-author', ix_demo_admin: 'bl-demo-admin',
  [SCENE_ID]: 'bl-scene-host',
};

/** Card texts, as in the concept. Plain text properties only; no workflow reads them. */
export const TEXTS = { ix_title: 'Welcome back', ix_sub: 'Sign in to your author dashboard.' };

/** The card column: the concept's 440 px card plus its 48 px right gutter. */
export const CARD_COLUMN_PX = 488;

/** Layout properties merged into existing elements (the scene's CSS finishes the look). */
const LAYOUT = {
  ix_split: { min_height_css: '100vh', fit_height: false, use_gap: false, column_gap: 0, vert_alignment: 'stretch' },
  ix_right: {
    fit_width: false, single_width: true, width: CARD_COLUMN_PX, min_width_css: `${CARD_COLUMN_PX}px`,
    max_width_css: `${CARD_COLUMN_PX}px`, padding_top: 88, padding_left: 0, padding_right: 48, padding_bottom: 28,
    container_vert_alignment: 'center',
  },
  ix_form: { max_width_css: '440px', horiz_alignment: 'center', row_gap: 16 },
};

/** The page snapshot taken before the redesign (its workflows and custom states are the contract). */
export const BEFORE = JSON.parse(readFileSync(new URL('./index-before.json', import.meta.url), 'utf8'));

/** The new left side: one HTML element holding the whole bookshelf scene. */
export function sceneElement(content = buildScene()) {
  const props = {
    order: 1, fit_width: false, fit_height: false, min_width_css: '0px', min_height_css: '0px',
    vert_alignment: 'stretch', horiz_alignment: 'stretch',
  };
  return withHtmlId({ ...html(SCENE_ID, content, props), name: 'Bookshelf Scene' }, HTML_IDS[SCENE_ID]);
}

/** Merges an element's layout, text and HTML id. Children are handled by `restyle`. */
function restyleOne(element) {
  const id = element.id;
  let next = { ...element, properties: { ...element.properties, ...(LAYOUT[id] ?? {}) } };
  if (TEXTS[id]) next = { ...next, properties: { ...next.properties, text: text(TEXTS[id]) } };
  return HTML_IDS[id] ? withHtmlId(next, HTML_IDS[id]) : next;
}

/** Restyles an element and, recursively, everything inside it. */
function restyle(element) {
  if (!element || typeof element !== 'object') return element; // Bubble's array-like `length` keys
  const next = restyleOne(element);
  if (!element.elements) return next;
  const children = Object.entries(element.elements).map(([key, child]) => [key, restyle(child)]);
  return { ...next, elements: Object.fromEntries(children) };
}

/** The new `ix_split`: old left panel out, scene in, ids and layout on the kept elements. */
export function buildSplit(split, content = buildScene()) {
  const kept = Object.entries(split.elements ?? {}).filter(([key]) => !REMOVED_KEYS.includes(key) && key !== SCENE_ID);
  const restyled = restyle({ ...split, elements: Object.fromEntries(kept) });
  return { ...restyled, elements: { [SCENE_ID]: sceneElement(content), ...restyled.elements } };
}

/**
 * The whole page after the redesign. Page properties, workflows and custom states are copied
 * through untouched; the writer only sends `ix_split` to Bubble.
 */
export function buildLoginPage(live = BEFORE, content = buildScene()) {
  const split = live.elements?.[SPLIT_KEY];
  if (!split || split.id !== 'ix_split') throw new Error(`Page ${PAGE_ID} has no ix_split at ${SPLIT_KEY}`);
  return {
    ...live,
    elements: { ...live.elements, [SPLIT_KEY]: buildSplit(split, content) },
  };
}
