// The page script that draws every `.bl-chart` box with Chart.js, plus its CSS.
// - Each box (sections/charts.mjs) is static HTML; its data lives in sibling "part" elements
//   (`data-bl-part="<chart id>"`) that Bubble fills in parallel. See chartData.mjs.
// - A MutationObserver redraws on the next frame after Bubble changes a part (no polling).
// - Until the data has arrived the box shows a CSS shimmer (`bl-loading`), no library.
// - Colours come from CSS variables (--bl-chart-*); a `bl-theme-change` event on window redraws.
import { payData, outcomesData, chartColors } from './chartData.mjs';

export const CHART_JS = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
/** If a chart's data is still empty after this long, it is really empty: draw it anyway. */
export const EMPTY_AFTER_MS = 8000;

export const CHART_CSS = `
<style>
.bl-chart{position:relative;width:100%}
.bl-chart.bl-loading canvas{visibility:hidden}
.bl-chart.bl-loading::before{content:'';position:absolute;inset:4px 0 0 0;border-radius:12px;
  background:linear-gradient(90deg,var(--bl-chart-grid,#f0ecee) 25%,var(--bl-chart-shimmer,#faf8f9) 50%,var(--bl-chart-grid,#f0ecee) 75%);
  background-size:200% 100%;animation:blsh 1.2s linear infinite}
@keyframes blsh{0%{background-position:200% 0}100%{background-position:-200% 0}}
</style>`;

// Chart.js configs. `c` is chartColors(); FONT and money() are defined in the script below.
const CONFIGS = `
  function doughnutConfig(d, c) {
    return { type: 'doughnut', data: { labels: d.labels, datasets: [{ data: d.values, backgroundColor: c.outcomes, borderWidth: 0 }] },
      options: { cutout: '70%', maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { font: FONT, color: c.text, boxWidth: 10, boxHeight: 10, usePointStyle: true } } } } };
  }
  function barConfig(d, c) {
    var ticks = { font: FONT, color: c.text };
    return { type: 'bar', data: { labels: d.labels, datasets: [
      { label: 'Paid', data: d.paid, backgroundColor: c.paid, borderRadius: 6, maxBarThickness: 26 },
      { label: 'Pending', data: d.pending, backgroundColor: c.pending, borderRadius: 6, maxBarThickness: 26 }] },
      options: { maintainAspectRatio: false,
        scales: { x: { stacked: true, grid: { display: false }, ticks: ticks },
          y: { stacked: true, grid: { color: c.grid }, ticks: { font: FONT, color: c.text, callback: function (v) { return money(v); } } } },
        plugins: { legend: { position: 'top', align: 'end', labels: { font: FONT, color: c.text, boxWidth: 10, boxHeight: 10, usePointStyle: true } },
          tooltip: { callbacks: { label: function (x) { return x.dataset.label + ': ' + money(x.raw); } } } } } };
  }`;

// Reads a box's parts, and draws (or redraws) it when they changed and are ready.
const DRAW = `
  function readParts(id) {
    var out = {};
    document.querySelectorAll('[data-bl-part="' + id + '"]').forEach(function (el) { out[el.getAttribute('data-key')] = el.textContent; });
    return out;
  }
  function dataFor(box, parts) {
    var d = box.dataset.kind === 'outcomes' ? outcomesData(parts) : payData(parts);
    if (d || box.dataset.kind === 'outcomes') return d;
    if (!box.__since) { box.__since = Date.now(); setTimeout(schedule, ${EMPTY_AFTER_MS} + 50); }
    return Date.now() - box.__since < ${EMPTY_AFTER_MS} ? null : { labels: [], paid: [], pending: [] };
  }
  function draw(box) {
    var parts = readParts(box.dataset.chart), raw = JSON.stringify(parts);
    if (box.__chart && box.__raw === raw) return;
    var d = dataFor(box, parts); if (!d) return;
    box.__raw = raw; if (box.__chart) box.__chart.destroy();
    var css = getComputedStyle(document.documentElement);
    var c = chartColors(function (n) { return css.getPropertyValue(n); });
    box.__chart = new window.Chart(box.querySelector('canvas'), box.dataset.kind === 'outcomes' ? doughnutConfig(d, c) : barConfig(d, c));
    box.classList.remove('bl-loading');
  }`;

// Wiring: load Chart.js once, redraw on DOM changes (one frame later) and on theme changes.
const WIRING = `
  var queued = false;
  function drawAll() { queued = false; if (window.Chart) document.querySelectorAll('.bl-chart').forEach(draw); }
  function schedule() { if (queued) return; queued = true; (window.requestAnimationFrame || setTimeout)(drawAll); }
  new MutationObserver(schedule).observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener('bl-theme-change', function () {
    document.querySelectorAll('.bl-chart').forEach(function (b) { b.__raw = null; }); schedule();
  });
  if (window.Chart) schedule();
  else { var s = document.createElement('script'); s.src = '${CHART_JS}'; s.onload = schedule; document.head.appendChild(s); }`;

export const CHART_SCRIPT = `
<script>
(function () {
  if (window.__blCharts) return; window.__blCharts = true;
  var FONT = { family: "'Nunito Sans', system-ui, sans-serif", size: 12 };
  function money(v) { return '₹' + Number(v).toLocaleString('en-IN'); }
  ${payData.toString()}
  ${outcomesData.toString()}
  ${chartColors.toString()}
${CONFIGS}
${DRAW}
${WIRING}
})();
</script>`;

export const CHART_HTML = CHART_CSS + CHART_SCRIPT;
