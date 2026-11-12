// Bubble side of the in-place regenerate: the page state that remembers the draft being replaced
// (`rv_prev`), the conditions the review pop-up uses to keep its editor on screen while n8n writes,
// and the hidden anchor element whose data attributes the page script (regen.js.mjs) reads.
// `log(...ops)` reads the pop-up's log (the new draft once Regenerate has created it).
// Conditions are chained left to right (Bubble has no brackets): ((a or b) and c).
import { chain, f, op, text, state, optionValue, dateFmt, and, or } from '../expr.mjs';
import { html } from '../ui.mjs';
import { PAGE } from '../queries.mjs';
import { REGEN_ANCHOR_ID } from './regen.css.mjs';

/** Page state (a notificationlog): the draft whose text stays on screen while its replacement is written. */
export const REGEN_PREV = 'rv_prev';
export const regenPrev = (...ops) => chain(state(PAGE, REGEN_PREV), ...ops);

const STAMP = 'yyyy-mm-dd HH:MM:ss';
const status = (log) => log(f.option('status', 'sendstatus'));
const statusIs = (log, v) => chain(status(log), op('equals', { args: optionValue('sendstatus', v) }));
const notReady = (log) => chain(status(log), op('not_equals', { args: optionValue('sendstatus', 'Draft ready') }));
/** The pop-up still shows the draft being replaced (Regenerate has not created the new one yet). */
const sameAsPrev = (log) => log(op('_id'), op('equals', { args: regenPrev(op('_id')) }));
const hasPrev = () => regenPrev(op('is_not_empty'));

/** A regenerate is under way or failed: the editor shows the replaced draft's text (under the mask). */
export const regenView = (log) => chain(sameAsPrev(log), or(notReady(log)), and(hasPrev()));

/** A regenerate is under way: Regenerate, Check my edits, Approve & send and Discard are disabled. */
export const regenLive = (log) =>
  chain(sameAsPrev(log), or(statusIs(log, 'Processing')), or(statusIs(log, 'Queued')), and(hasPrev()));

/** The editor and preview stay on screen: a draft is ready, or a regenerate is under way or failed. */
export const editorShown = (log) => chain(regenView(log), or(statusIs(log, 'Draft ready')));

/** First-time writing (no draft to keep on screen): the full progress card, as before. */
export const firstWriting = (log) =>
  chain(statusIs(log, 'Processing'), or(statusIs(log, 'Queued')), and(regenPrev(op('is_empty'))));

/** A failure outside a regenerate (a regenerate's failure is shown inside the mask instead). */
export const plainFailure = (log) => chain(statusIs(log, 'Failed'), and(regenPrev(op('is_empty'))));

const quoteSafe = () => op('find_replace', { properties: { find: text('"'), replace: text("'"), use_regex: false }, slidable: true });

/** The hidden anchor (CSS takes it out of the layout, so it adds no gap). */
export function regenAnchor(log) {
  return html(REGEN_ANCHOR_ID, text(
    '<div class="bl-regen-src" hidden data-prev="', regenPrev(op('_id')),
    '" data-log="', log(op('_id')),
    '" data-status="', log(f.option('status', 'sendstatus'), op('display')),
    '" data-stage="', log(f.text('stage')),
    '" data-start="', log(f.date('requested_at'), dateFmt(STAMP)),
    '" data-error="', log(f.text('error'), quoteSafe()),
    '"></div>',
  ), { min_height_css: '0px', height: 0 });
}
