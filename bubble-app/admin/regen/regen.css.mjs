// Styles for the in-place "Regenerate draft" mask (ink and paper, like the login page). Every colour
// is a --bl-* theme variable, so light and dark both work. The page script (regen.js.mjs) lays one
// mask over the subject, the email text box and the preview while n8n writes the new draft.
import { writeCss, inkMaskUrl, inkTile, LINE_PITCH, INK_HEIGHT } from './regenDraw.mjs';

/** Element name of the pop-up's hidden data anchor (Bubble turns element names into CSS classes). */
export const REGEN_ANCHOR_ID = 'ad_rv_fx';

const EASE = 'var(--bl-ease,cubic-bezier(.2,.8,.2,1))';
const LINES_TOP = 24; // px from the mask top to the first ink line
const RULE = LINES_TOP + INK_HEIGHT - 2; // the veil's ruled lines sit under each ink line

// Ruled paper and a notebook margin, behind a veil that lets the old text show through faintly.
const VEIL = `
.bl-rg{position:absolute;z-index:6;overflow:hidden;pointer-events:none;border-radius:12px;contain:paint;transition:opacity .32s ${EASE}}
.bl-rg[data-phase=live],.bl-rg[data-phase=done]{pointer-events:auto;cursor:progress}
.bl-rg.is-out{opacity:0}
.bl-rg-veil{position:absolute;inset:0;opacity:0;transition:opacity .45s ${EASE},background-color .3s ${EASE};
  background-color:color-mix(in srgb,var(--bl-panel,#fffcfb) 80%,transparent);
  background-image:linear-gradient(90deg,transparent 17px,rgba(var(--bl-brand-rgb,200,71,90),.22) 17px 18px,transparent 18px),
    repeating-linear-gradient(180deg,transparent 0 ${LINE_PITCH - 1}px,rgba(var(--bl-brand-rgb,200,71,90),.09) ${LINE_PITCH - 1}px ${LINE_PITCH}px);
  background-position:0 0,0 ${RULE - LINE_PITCH + 1}px;-webkit-backdrop-filter:blur(1.4px) saturate(.7);backdrop-filter:blur(1.4px) saturate(.7)}
.bl-rg[data-phase=live] .bl-rg-veil{opacity:1}
.bl-rg[data-phase=done] .bl-rg-veil{opacity:1;background-color:color-mix(in srgb,var(--bl-panel,#fffcfb) 95%,transparent)}
.bl-rg[data-kind=line] .bl-rg-veil{background-image:none}`;

// Cursive ink strokes (an SVG squiggle used as a mask) with a rose sheen running through them.
const SQUIGGLE = inkMaskUrl();
const TILE = `${inkTile().width}px ${INK_HEIGHT}px`;
const INK_RGBA = (a) => `color-mix(in srgb,var(--bl-navy,#3d3550) ${a}%,transparent)`;
const INK = `
.bl-rg-lines{position:absolute;top:${LINES_TOP}px;left:30px;right:26px;display:flex;flex-direction:column;gap:${LINE_PITCH - INK_HEIGHT}px;opacity:0;transition:opacity .3s ${EASE}}
.bl-rg[data-kind=line] .bl-rg-lines{top:calc(50% - ${INK_HEIGHT / 2}px);left:14px;right:14px}
.bl-rg[data-kind=mail] .bl-rg-lines{top:${LINES_TOP + 70}px}
.bl-rg[data-phase=live] .bl-rg-lines,.bl-rg[data-phase=done] .bl-rg-lines{opacity:1}
.bl-rg-ln{display:block;height:${INK_HEIGHT}px}
.bl-rg-ln b{display:block;height:100%;width:0;-webkit-mask:${SQUIGGLE} var(--mx,0) 50%/${TILE} repeat-x;mask:${SQUIGGLE} var(--mx,0) 50%/${TILE} repeat-x;
  background:linear-gradient(90deg,${INK_RGBA(78)} 0 38%,rgba(var(--bl-brand-rgb,200,71,90),.95) 50%,${INK_RGBA(78)} 62% 100%);
  background-size:300% 100%;animation-iteration-count:infinite;animation-timing-function:cubic-bezier(.45,.05,.55,.95),linear}
.bl-rg[data-phase=done][data-kind] .bl-rg-ln:nth-child(n) b{animation:none;width:100%;transition:width .25s ${EASE}}
.bl-rg-nib{position:absolute;left:0;top:0;width:20px;height:20px;margin:-13px 0 0 -3px;pointer-events:none}
.bl-rg-nib svg{width:100%;height:100%;display:block;animation:bl-rg-wob .26s ease-in-out infinite alternate;transform-origin:3px 21px}
.bl-rg-nib-body{fill:var(--bl-navy,#3d3550)}.bl-rg-nib-slit{stroke:var(--bl-panel,#fffcfb);stroke-width:1.2;stroke-linecap:round}
.bl-rg-nib-vent{fill:var(--bl-brand,#c8475a)}
.bl-rg[data-phase=done][data-kind] .bl-rg-nib{animation:none;opacity:0;transition:opacity .2s}
@keyframes bl-rg-sheen{from{background-position:100% 0}to{background-position:-100% 0}}
@keyframes bl-rg-wob{from{transform:rotate(-4deg)}to{transform:rotate(3deg) translateY(-1px)}}`;

// The step tag: the current step in Fraunces italic, three step dots and the seconds counter.
const TAG = `
.bl-rg-tag{position:absolute;left:50%;bottom:calc(16px + var(--vis-b,0px));transform:translateX(-50%);display:flex;align-items:center;gap:10px;white-space:nowrap;
  padding:7px 14px 7px 8px;border-radius:999px;background:var(--bl-panel,#fffcfb);border:1px solid var(--bl-border-strong,rgba(31,26,28,.17));
  box-shadow:0 14px 30px -18px var(--bl-shadow-float,rgba(80,30,40,.34));font:600 12px var(--bl-font-ui,system-ui),sans-serif;color:var(--bl-text-2,#5f5056);
  opacity:0;transition:opacity .3s ${EASE}}
.bl-rg[data-kind=mail] .bl-rg-tag{bottom:auto;top:18px;padding:5px 12px 5px 6px}
.bl-rg[data-phase=live] .bl-rg-tag,.bl-rg[data-phase=done] .bl-rg-tag{opacity:1}
.bl-rg-ic{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:var(--bl-brand-soft,#fbe6e8)}
.bl-rg-ic svg{width:14px;height:14px}.bl-rg-ic .bl-rg-nib-body{fill:var(--bl-brand-ink,#a83a4d)}
.bl-rg-step{font:italic 500 15px/1 var(--bl-font-display,Georgia),serif;color:var(--bl-text-1,#1f1a1c)}
.bl-rg[data-kind=mail] .bl-rg-step{font-size:13px;color:var(--bl-text-2,#5f5056)}
.bl-rg-step.is-new{animation:bl-rg-pop .35s ${EASE}}
.bl-rg-dots{display:inline-flex;gap:5px}.bl-rg-dots i{width:7px;height:7px;border-radius:50%;background:var(--bl-border-strong,rgba(31,26,28,.17))}
.bl-rg-dots i.done{background:var(--bl-success,#1d7a4b)}.bl-rg-dots i.now{background:var(--bl-brand,#c8475a);animation:blp 1.2s infinite}
.bl-rg-t{font-style:normal;font-variant-numeric:tabular-nums;color:var(--bl-text-3,#8d7c83);min-width:28px;text-align:right}
.bl-rg[data-phase=done] .bl-rg-step{color:var(--bl-success,#1d7a4b);font-style:normal;font-family:var(--bl-font-ui,system-ui),sans-serif;font-weight:800;font-size:14px}
.bl-rg[data-phase=done] .bl-rg-ic{background:var(--bl-success-bg,#e5f3ea)}
@keyframes bl-rg-pop{from{opacity:0;transform:translateY(4px)}}`;

// Failure: the veil lifts (old text readable again) and a calm note rests at the bottom of the box.
const NOTE = `
.bl-rg-note{display:none}
.bl-rg[data-phase=failed] .bl-rg-note{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:start;position:absolute;left:12px;right:12px;bottom:calc(12px + var(--vis-b,0px));
  padding:10px 12px;border-radius:12px;pointer-events:auto;animation:bl-rg-pop .35s ${EASE};
  background:linear-gradient(var(--bl-danger-bg,#fbe8e6),var(--bl-danger-bg,#fbe8e6)),var(--bl-panel,#fffcfb);border:1px solid rgba(var(--bl-danger-rgb,179,38,30),.22);
  box-shadow:0 12px 26px -18px var(--bl-shadow-float,rgba(80,30,40,.34));font:500 12.5px/1.45 var(--bl-font-ui,system-ui),sans-serif;color:var(--bl-text-2,#5f5056)}
.bl-rg-note-ic{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font:800 13px var(--bl-font-ui,system-ui);color:var(--bl-danger,#b3261e);border:1.5px solid currentColor}
.bl-rg-note-t{display:block;font-weight:700;color:var(--bl-text-1,#1f1a1c)}.bl-rg-note-d{margin:2px 0 0}
.bl-rg-note-x{border:0;background:transparent;font:700 12px var(--bl-font-ui,system-ui);color:var(--bl-text-2,#5f5056);padding:4px 6px;border-radius:8px;cursor:pointer}
.bl-rg-note-x:hover{background:rgba(var(--bl-danger-rgb,179,38,30),.08)}`;

// The new text, subject and preview settle in after "Done".
const ARRIVE = `
.bl-rg-in{animation:bl-rg-in .45s ${EASE} both}
@keyframes bl-rg-in{from{opacity:0;filter:blur(1.5px);transform:translateY(3px)}}
.${REGEN_ANCHOR_ID}{position:absolute!important;width:0!important;height:0!important;min-height:0!important;overflow:hidden!important;pointer-events:none}`;

// Reduced motion: a still veil and the step text only.
const CALM = `
@media (prefers-reduced-motion:reduce){.bl-rg-lines,.bl-rg-nib{display:none!important}
.bl-rg,.bl-rg *,.bl-rg-in{animation:none!important;transition:none!important}}`;

export const REGEN_CSS = `<style>${VEIL}${INK}\n${writeCss()}${TAG}${NOTE}${ARRIVE}${CALM}\n</style>`;
