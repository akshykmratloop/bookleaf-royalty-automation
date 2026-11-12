// Chart.js charts drawn by the page script (chartScript.mjs).
// Each chart is a group: one static box (`.bl-chart`, shows a shimmer until drawn) plus small
// hidden "part" elements that each hold one piece of data. Bubble evaluates the parts of a single
// text one after another, but separate elements together, in one batched request. So every value
// that needs the server gets its own element, and per-author sums are done in the browser
// (chartData.mjs) from one list of royalty records instead of one server sum per author.
import { chain, f, op, text, injected, search, sorted, formatList, jsonSafe } from '../expr.mjs';
import { group, html } from '../ui.mjs';
import { logsWithStatus } from '../queries.mjs';

/** Statuses counted for the outcomes chart, with the part id suffix for each. */
export const OUTCOME_PARTS = [
  ['Sent', 'sent'], ['Failed', 'failed'], ['Draft ready', 'draft'], ['Processing', 'proc'],
  ['Queued', 'queued'], ['Discarded', 'disc'], ['Duplicate', 'dup'],
];

const item = (...ops) => chain(injected(), ...ops);

/** One part: `<script type="application/json" data-bl-part="<chart id>" data-key="<key>">value</script>`. */
const part = (chartId, suffix, key, ...value) => html(`${chartId}_${suffix}`, text(
  `<script type="application/json" data-bl-part="${chartId}" data-key="${key}">`, ...value, '</script>',
), { min_height_css: '0px', height: 0 });

function chartGroup(chartId, kind, height, parts) {
  const box = html(`${chartId}_box`, text(
    `<div class="bl-chart bl-loading" data-kind="${kind}" data-chart="${chartId}" style="height:${height}px"><canvas></canvas></div>`,
  ), { min_height_css: `${height}px` });
  return group(chartId, [box, ...parts], { gap: 0, props: { fit_width: false, min_width_css: '0px' } });
}

/** [["<author id>","<name>"],...], A to Z. */
const authorsPart = (chartId) => part(chartId, 'authors', 'authors', '[', chain(
  search('author'), sorted('name_text', false),
  formatList(text('["', item(op('_id')), '",', item(f.text('name'), jsonSafe()), ']'), ','),
), ']');

/** [["<author id>","<paid>","<pending>"],...]: every royalty record, one search. */
const rowsPart = (chartId) => part(chartId, 'rows', 'rows', '[', chain(
  search('royaltyrecord'),
  formatList(text('["', item(f.thing('author', 'author'), op('_id')), '","', item(f.num('paid')), '","', item(f.num('pending')), '"]'), ','),
), ']');

/** Stacked bars: paid vs pending royalties for each author. */
export const payChart = (id) => chartGroup(id, 'pay', 280, [authorsPart(id), rowsPart(id)]);

/** Doughnut: what happened to every royalty email so far (one count per status, summed in the browser). */
export const outcomesChart = (id) => chartGroup(id, 'outcomes', 200,
  OUTCOME_PARTS.map(([status, suffix]) => part(id, suffix, status, chain(logsWithStatus(status), op('count')))));
