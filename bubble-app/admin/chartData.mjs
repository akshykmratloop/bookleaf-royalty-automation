// Pure chart logic. These functions are tested here and also copied, as source text, into the
// page script (chartScript.mjs), so they must stay self-contained: no imports, no outer variables.
//
// Bubble writes each piece of chart data into its own small HTML element ("part"). Separate
// elements let Bubble fetch them all in one batched request; one long text would fetch them one
// after another (that made the pay chart wait for 20 sums in a row, about 8 seconds).
// `parts` maps a part's key to the raw text Bubble rendered for it.

/** Paid vs pending per author, from one list of authors and one list of royalty records.
 *  parts.authors = '[["<author id>","<name>"],...]' (A to Z), parts.rows = '[["<author id>","<paid>","<pending>"],...]'.
 *  Returns null while Bubble is still loading (bad JSON, or no authors or no records yet: Bubble renders
 *  a list it has not fetched as `[]`, and drawing then would flash an all-zero chart). */
export function payData(parts) {
  var authors, rows;
  try {
    authors = JSON.parse(parts.authors);
    rows = JSON.parse(parts.rows);
  } catch (e) {
    return null;
  }
  if (!Array.isArray(authors) || !Array.isArray(rows) || authors.length === 0 || rows.length === 0) return null;
  var num = function (v) { var n = Number(v); return isFinite(n) ? n : 0; };
  var at = {};
  authors.forEach(function (a, i) { at[a[0]] = i; });
  var paid = authors.map(function () { return 0; });
  var pending = authors.map(function () { return 0; });
  rows.forEach(function (r) {
    var i = at[r[0]];
    if (i === undefined) return;
    paid[i] += num(r[1]);
    pending[i] += num(r[2]);
  });
  return { labels: authors.map(function (a) { return a[1]; }), paid: paid, pending: pending };
}

/** Email outcomes from one count per status. Returns null until every count has arrived. */
export function outcomesData(parts) {
  var KEYS = ['Sent', 'Failed', 'Draft ready', 'Processing', 'Queued', 'Discarded', 'Duplicate'];
  var n = {};
  for (var k = 0; k < KEYS.length; k++) {
    var raw = String(parts[KEYS[k]] === undefined ? '' : parts[KEYS[k]]).trim();
    if (raw === '' || !isFinite(Number(raw))) return null;
    n[KEYS[k]] = Number(raw);
  }
  return {
    labels: ['Sent', 'Failed', 'Draft ready', 'In progress', 'Discarded'],
    values: [n.Sent, n.Failed, n['Draft ready'], n.Processing + n.Queued, n.Discarded + n.Duplicate],
  };
}

/** Chart colours from CSS variables (set by the theme), falling back to today's light colours.
 *  get(name) returns the variable's value ('' when it is not set). */
export function chartColors(get) {
  var pick = function (name, fallback) { var v = String(get(name) || '').trim(); return v || fallback; };
  return {
    text: pick('--bl-chart-text', '#666666'),
    grid: pick('--bl-chart-grid', '#f0ecee'),
    paid: pick('--bl-chart-paid', '#35465c'),
    pending: pick('--bl-chart-pending', '#d13f53'),
    outcomes: [
      pick('--bl-chart-sent', '#0f8a4f'),
      pick('--bl-chart-failed', '#c42b2b'),
      pick('--bl-chart-draft', '#2f6db5'),
      pick('--bl-chart-progress', '#f59e0b'),
      pick('--bl-chart-discarded', '#ddd5d9'),
    ],
  };
}
