// Page-level CSS and one small script, injected once by an HTML element in the sidebar.
// - CSS: fixed app shell (only the content area scrolls), the progress stepper and e-mail frame look,
//   coloured by the theme layer's --bl-* variables (bubble-app/theme/; fonts load there too).
// - Script: renders every `.bl-stp` progress stepper with a live seconds timer.
// - Pop-ups: popupStyle.mjs caps each pop-up at the window height with one scrolling middle.
// - Charts: chartScript.mjs draws every `.bl-chart` with Chart.js (its own CSS and script).
// - Regenerate: regen/ draws the in-place "being rewritten" mask in the review pop-up.
// - The email preview's dark mode lives in the shared theme layer (theme/css/04-mail.css).
import { CHART_HTML } from './chartScript.mjs';
import { POPUP_CSS } from './popupStyle.mjs';
import { REGEN_HTML } from './regen/regen.js.mjs';

export { CHART_JS } from './chartScript.mjs';

export const CSS = `
<style>
html,body{height:100%;overflow:hidden!important;overscroll-behavior:none;background-color:var(--bl-bg,#fbf3f1)}
#ad_side{height:100vh!important;max-height:100vh;overflow-y:auto!important;overscroll-behavior:none;flex-shrink:0}
#ad_main{height:100vh!important;max-height:100vh;overflow-y:auto!important;overscroll-behavior:none}
#ad_main *{font-variant-numeric:tabular-nums}
.bl-st-row{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font:600 12px var(--bl-font-ui,system-ui),sans-serif;color:var(--bl-text-3,#8d7c83)}
.bl-st{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.bl-st i{width:8px;height:8px;border-radius:50%;background:var(--bl-border-strong,#ddd5d9);display:inline-block}
.bl-st.done{color:var(--bl-success,#1d7a4b)}.bl-st.done i{background:var(--bl-success,#1d7a4b)}
.bl-st.now{color:var(--bl-brand-ink,#a83a4d)}.bl-st.now i{background:var(--bl-brand,#c8475a);animation:blp 1.2s infinite}
.bl-st.fail{color:var(--bl-danger,#b3261e)}.bl-st.fail i{background:var(--bl-danger,#b3261e)}
.bl-t{margin-left:auto;font:700 12px var(--bl-font-ui,system-ui),sans-serif;color:var(--bl-text-2,#5f5056)}
.bl-mail{max-height:62vh;overflow:auto;border:1px solid var(--bl-border,#ece7ea);border-radius:12px;background:#fff;color:#1f1a1c;color-scheme:light;box-shadow:0 0 0 6px var(--bl-mail-frame,#f3e7e5),0 18px 40px -24px var(--bl-shadow-card,rgba(140,40,62,.22))}
.bl-issues{white-space:pre-wrap;font:600 12.5px/1.5 var(--bl-font-ui,system-ui),sans-serif;color:var(--bl-danger,#b3261e)}
@keyframes blp{0%{box-shadow:0 0 0 0 rgba(var(--bl-brand-rgb,200,71,90),.45)}70%{box-shadow:0 0 0 7px rgba(var(--bl-brand-rgb,200,71,90),0)}100%{box-shadow:0 0 0 0 rgba(var(--bl-brand-rgb,200,71,90),0)}}
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
  function tick() { document.querySelectorAll('.bl-stp').forEach(stepper); }
  tick();
  setInterval(tick, 500);
})();
</script>`;

/** Everything the sidebar's style element carries after the theme layer (pop-up layout included). */
export const SHELL_HTML = CSS + POPUP_CSS + SCRIPT + CHART_HTML + REGEN_HTML;
