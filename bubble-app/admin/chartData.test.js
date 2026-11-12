// The browser-side chart maths, and the page script that carries it.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { payData, outcomesData, chartColors } from './chartData.mjs';
import { CHART_SCRIPT } from './chartScript.mjs';
import { payChart, outcomesChart, OUTCOME_PARTS } from './sections/charts.mjs';

const sample = JSON.parse(readFileSync(new URL('../../data/bookleaf_sample_data.json', import.meta.url), 'utf8'));

/** What Bubble renders into the two pay-chart parts for the seeded data. */
function payPartsFromSample() {
  const authors = [...sample.authors].sort((a, b) => a.name.localeCompare(b.name));
  const rows = sample.authors.flatMap((a) => a.books.map((b) => [a.author_id, String(b.royalty_paid), String(b.royalty_pending)]));
  return { authors: JSON.stringify(authors.map((a) => [a.author_id, a.name])), rows: JSON.stringify(rows) };
}

describe('payData', () => {
  it('gives the same per-author totals the live chart showed (12 Nov 2026)', () => {
    expect(payData(payPartsFromSample())).toEqual({
      labels: ['Ananya Reddy', 'Arjun Malhotra', 'Diya Chatterjee', 'Farhan Sheikh', 'Kavita Deshmukh', 'Meera Nair', 'Priya Sharma', 'Rohit Kapoor', 'Sneha Kulkarni', 'Vikram Joshi'],
      paid: [0, 0, 25000, 3120, 0, 22240, 16338, 71000, 53000, 11845],
      pending: [2546, 2464, 4115, 0, 850, 3055, 3570, 13024, 7865, 3350],
    });
  });

  it('keeps authors with no records at zero and ignores records of unknown authors', () => {
    const d = payData({ authors: '[["a","A"],["b","B"]]', rows: '[["a","10","5"],["x","99","99"],["a","2.5",""]]' });
    expect(d).toEqual({ labels: ['A', 'B'], paid: [12.5, 0], pending: [5, 0] });
  });

  it('is not ready while Bubble is loading', () => {
    expect(payData({ authors: '[]', rows: '[]' })).toBeNull();
    expect(payData({ authors: '[["a","A"]', rows: '[]' })).toBeNull();
    expect(payData({})).toBeNull();
    expect(payData({ authors: '[["a","A"]]', rows: '[]' })).toBeNull(); // records not fetched yet
  });
});

describe('outcomesData', () => {
  const counts = { Sent: '28', Failed: '12', 'Draft ready': '1', Processing: '0', Queued: '0', Discarded: '3', Duplicate: '1' };

  it('adds Processing + Queued and Discarded + Duplicate, as the old single text did', () => {
    expect(outcomesData(counts)).toEqual({ labels: ['Sent', 'Failed', 'Draft ready', 'In progress', 'Discarded'], values: [28, 12, 1, 0, 4] });
  });

  it('waits until every count has arrived', () => {
    expect(outcomesData({ ...counts, Queued: '' })).toBeNull();
    expect(outcomesData({ ...counts, Duplicate: undefined })).toBeNull();
  });
});

describe('chartColors', () => {
  it('falls back to the light colours and uses theme variables when set', () => {
    expect(chartColors(() => '')).toMatchObject({ text: '#666666', grid: '#f0ecee', paid: '#35465c', pending: '#d13f53' });
    const dark = chartColors((n) => ({ '--bl-chart-text': ' #e5e7eb', '--bl-chart-grid': '#2a2f3a' }[n] ?? ''));
    expect(dark).toMatchObject({ text: '#e5e7eb', grid: '#2a2f3a', paid: '#35465c' });
    expect(dark.outcomes).toHaveLength(5);
  });
});

describe('chart elements and page script', () => {
  const partsOf = (g) => Object.values(g.elements).filter((e) => e.id !== `${g.id}_box`);

  it('gives every value its own element, keyed the way chartData reads them', () => {
    expect(partsOf(payChart('c')).map((e) => e.id).sort()).toEqual(['c_authors', 'c_rows']);
    const keys = partsOf(outcomesChart('o')).map((e) => JSON.stringify(e.properties.html).match(/data-key=\\"([^\\]+)\\"/)[1]);
    expect(keys).toEqual(OUTCOME_PARTS.map(([status]) => status));
  });

  it('is valid JavaScript that carries the tested functions', () => {
    const body = CHART_SCRIPT.replace(/^\s*<script>/, '').replace(/<\/script>\s*$/, '');
    expect(() => new Function(body)).not.toThrow();
    for (const fn of [payData, outcomesData, chartColors]) expect(CHART_SCRIPT).toContain(fn.toString());
    expect(CHART_SCRIPT).toContain("'bl-theme-change'");
  });
});
