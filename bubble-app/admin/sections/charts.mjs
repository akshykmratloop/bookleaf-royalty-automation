// Chart.js charts drawn by the page script (assets.mjs) from JSON that Bubble writes into HTML elements.
import { chain, f, op, text, injected, search, sorted, formatList, jsonSafe } from '../expr.mjs';
import { html } from '../ui.mjs';
import { logsWithStatus } from '../queries.mjs';

const authorsAZ = () => chain(search('author'), sorted('name_text', false));
const sumFor = (field) => chain(search('royaltyrecord', [['author_custom_author', 'equals', injected()]]), f.num(field), op('sum'));
const series = (content) => chain(authorsAZ(), formatList(text(content), ','));
const count = (status) => chain(logsWithStatus(status), op('count'));

function chartBox(id, kind, json, height) {
  return html(id, text(
    `<div class="bl-chart" data-kind="${kind}" style="height:${height}px"><canvas></canvas><script type="application/json">`,
    ...json,
    '</script></div>',
  ), { min_height_css: `${height}px` });
}

/** Stacked bars: paid vs pending royalties for each author. */
export const payChart = (id) => chartBox(id, 'pay', [
  '{"labels":[', series(chain(injected(), f.text('name'), jsonSafe())), '],',
  '"paid":[', series(sumFor('paid')), '],',
  '"pending":[', series(sumFor('pending')), ']}',
], 280);

/** Doughnut: what happened to every royalty email so far. */
export const outcomesChart = (id) => chartBox(id, 'outcomes', [
  '{"labels":["Sent","Failed","Draft ready","In progress","Discarded"],"values":[',
  count('Sent'), ',', count('Failed'), ',', count('Draft ready'), ',',
  chain(count('Processing'), op('plus', { args: count('Queued') })), ',',
  chain(count('Discarded'), op('plus', { args: count('Duplicate') })), ']}',
], 200);
