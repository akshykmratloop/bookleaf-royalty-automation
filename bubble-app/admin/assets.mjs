// Page-level CSS and one small script, injected once by an HTML element in the sidebar.
// - CSS: fixed app shell (only the content area scrolls), fonts, the progress stepper look.
// - Script: renders every `.bl-stp` progress stepper with a live seconds timer, and draws every
//   `.bl-chart` with Chart.js from the JSON Bubble writes inside it. Bubble re-renders those
//   HTML elements whenever their data changes; the script simply redraws what it finds.

export const CHART_JS = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';

export const CSS = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700;6..12,800&display=swap" rel="stylesheet">
<style>
html,body{height:100%;overflow:hidden!important;overscroll-behavior:none;background:#f6f5f7}
#ad_side{height:100vh!important;max-height:100vh;overflow-y:auto!important;overscroll-behavior:none;flex-shrink:0}
#ad_main{height:100vh!important;max-height:100vh;overflow-y:auto!important;overscroll-behavior:none}
#ad_main *{font-variant-numeric:tabular-nums}
.bl-st-row{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font:600 12px 'Nunito Sans',system-ui,sans-serif;color:#8a8686}
.bl-st{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.bl-st i{width:8px;height:8px;border-radius:50%;background:#ddd5d9;display:inline-block}
.bl-st.done{color:#0f8a4f}.bl-st.done i{background:#0f8a4f}
.bl-st.now{color:#c8384c}.bl-st.now i{background:#d13f53;animation:blp 1.2s infinite}
.bl-st.fail{color:#c42b2b}.bl-st.fail i{background:#c42b2b}
.bl-t{margin-left:auto;font:700 12px 'Nunito Sans',system-ui,sans-serif;color:#5e5e5e}
.bl-chart{position:relative;width:100%}
.bl-mail{max-height:62vh;overflow:auto;border:1px solid #ece7ea;border-radius:12px;background:#fff}
.bl-issues{white-space:pre-wrap;font:600 12.5px/1.5 'Nunito Sans',system-ui,sans-serif;color:#c42b2b}
@keyframes blp{0%{box-shadow:0 0 0 0 rgba(209,63,83,.45)}70%{box-shadow:0 0 0 7px rgba(209,63,83,0)}100%{box-shadow:0 0 0 0 rgba(209,63,83,0)}}
</style>`;

const SCRIPT = `
<script>
(function () {
  if (window.__blShell) return; window.__blShell = true;
  var STEPS = {
    send: ['Queued', 'Reading data', 'Writing with AI', 'Fact-checking', 'Sending', 'Sent'],
    draft: ['Queued', 'Reading data', 'Writing with AI', 'Fact-checking', 'Draft ready']
  };
  var AT = { queued: 0, reading_data: 1, writing: 2, checking: 3, rewriting: 3, sending: 4, sent: 5, drafted: 4 };
  function when(v) { var t = Date.parse(String(v || '').replace(' ', 'T')); return isNaN(t) ? null : t; }
  function elapsed(el, final) {
    var s = when(el.dataset.start); if (s === null) return '';
    var e = (final && when(el.dataset.end)) || Date.now(); var d = Math.max(0, Math.round((e - s) / 1000));
    return d < 60 ? d + 's' : Math.floor(d / 60) + 'm ' + (d % 60) + 's';
  }
  function stepper(el) {
    var kind = el.dataset.kind === 'draft' ? 'draft' : 'send', steps = STEPS[kind];
    var stage = el.dataset.stage || 'queued', status = el.dataset.status || '';
    var done = status === 'Sent' || status === 'Draft ready', failed = status === 'Failed';
    var at = AT[stage] === undefined ? 0 : Math.min(AT[stage], steps.length - 1);
    var h = '<div class="bl-st-row">';
    steps.forEach(function (s, k) {
      var c = done || k < at ? 'done' : k === at ? (failed ? 'fail' : 'now') : 'todo';
      h += '<span class="bl-st ' + c + '"><i></i>' + s + '</span>';
    });
    h += '<b class="bl-t">' + (failed ? 'Failed after ' : done ? 'Done in ' : '') + elapsed(el, done || failed) + '</b></div>';
    if (el.__h !== h) { el.innerHTML = h; el.__h = h; }
  }
  var FONT = { family: "'Nunito Sans', system-ui, sans-serif", size: 12 };
  function config(kind, d) {
    if (kind === 'outcomes') return { type: 'doughnut', data: { labels: d.labels, datasets: [{ data: d.values,
      backgroundColor: ['#0f8a4f', '#c42b2b', '#2f6db5', '#f59e0b', '#ddd5d9'], borderWidth: 0 }] },
      options: { cutout: '70%', maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: FONT, boxWidth: 10, boxHeight: 10, usePointStyle: true } } } } };
    return { type: 'bar', data: { labels: d.labels, datasets: [
      { label: 'Paid', data: d.paid, backgroundColor: '#35465c', borderRadius: 6, maxBarThickness: 26 },
      { label: 'Pending', data: d.pending, backgroundColor: '#d13f53', borderRadius: 6, maxBarThickness: 26 }] },
      options: { maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false }, ticks: { font: FONT } },
        y: { stacked: true, grid: { color: '#f0ecee' }, ticks: { font: FONT, callback: function (v) { return '₹' + Number(v).toLocaleString('en-IN'); } } } },
        plugins: { legend: { position: 'top', align: 'end', labels: { font: FONT, boxWidth: 10, boxHeight: 10, usePointStyle: true } },
          tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ₹' + Number(c.raw).toLocaleString('en-IN'); } } } } } };
  }
  function charts() {
    if (!window.Chart) return;
    document.querySelectorAll('.bl-chart').forEach(function (box) {
      var src = box.querySelector('script[type="application/json"]'); if (!src) return;
      var raw = src.textContent; if (box.__raw === raw) return;
      var d; try { d = JSON.parse(raw); } catch (e) { return; }
      box.__raw = raw; if (box.__chart) box.__chart.destroy();
      box.__chart = new window.Chart(box.querySelector('canvas'), config(box.dataset.kind, d));
    });
  }
  function tick() { document.querySelectorAll('.bl-stp').forEach(stepper); charts(); }
  var s = document.createElement('script'); s.src = '${CHART_JS}'; s.onload = tick; document.head.appendChild(s);
  setInterval(tick, 500);
})();
</script>`;

export const SHELL_HTML = CSS + SCRIPT;
