// The drawing of the "being rewritten" mask: ink lines written one after another by a moving pen
// nib, over a paper veil. Built once in Node: per-kind keyframes (each line's writing window and the
// nib's path along all lines) and the mask markup the page script clones over each target.
// Kinds: 'text' = the email text box, 'mail' = the preview, 'line' = the subject.

/** Line lengths (% of the mask width), one entry per ink line. */
export const REGEN_LINES = {
  text: [94, 86, 97, 71, 90, 56],
  mail: [62, 93, 84, 47],
  line: [58],
};

/** Distance between ink-line tops (px): INK_HEIGHT line + 10px gap, matching the veil's ruled lines. */
export const LINE_PITCH = 22;
/** Height of one ink line (px). */
export const INK_HEIGHT = 12;

// Handwriting: "words" of cursive arches (heights vary, every few letters an ascender), with gaps.
const WORDS = [34, 22, 46, 18];
const HUMPS = [3.2, 4.4, 2.6, 7.2, 3.8, 2.9, 4.8, 3.4, 6.6, 2.8, 4.1, 3.6];
const WORD_GAP = 9;

/** The repeating handwriting tile: { width, path } (SVG path in a width × INK_HEIGHT box, baseline at 9). */
export function inkTile() {
  let x = 2, k = 0;
  const parts = WORDS.map((len) => {
    let d = `M${x} 9`;
    const end = x + len;
    while (x < end) {
      const w = 5 + (k % 3), h = HUMPS[k % HUMPS.length];
      d += `c${(w * 0.25).toFixed(1)} ${-h} ${(w * 0.8).toFixed(1)} ${-h} ${w} 0`;
      x += w; k += 1;
    }
    x += WORD_GAP;
    return d;
  });
  return { width: x, path: parts.join('') };
}

/** The handwriting tile as a CSS url(), for use as a mask. */
export function inkMaskUrl() {
  const { width, path } = inkTile();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${INK_HEIGHT}'><path d='${path}' fill='none' stroke='#000' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
/** Seconds to write one line (the nib swings back to the margin in the last 18% of it). */
export const WRITE_SECONDS = 0.95;
/** Seconds the finished page rests before it is wiped and written again. */
export const REST_SECONDS = 1.1;
const WRITING_SHARE = 0.82;

const pct = (n) => `${Number(n.toFixed(2))}%`;

/** Total seconds of one writing cycle for `count` lines. */
export const cycleSeconds = (count) => Number((count * WRITE_SECONDS + REST_SECONDS).toFixed(2));

/** [start, end] of each line's writing window, as % of the cycle. */
export function lineWindows(count) {
  const total = cycleSeconds(count);
  return Array.from({ length: count }, (_, i) => {
    const start = (i * WRITE_SECONDS) / total;
    const end = (i * WRITE_SECONDS + WRITE_SECONDS * WRITING_SHARE) / total;
    return [start * 100, end * 100];
  });
}

/** One line's keyframes: hidden until its window, grows across it, rests, fades with the page. */
function lineKeyframes(kind, i, [start, end]) {
  const head = start > 0 ? `0%,${pct(start)}{width:0;opacity:1}` : '0%{width:0;opacity:1}';
  return `@keyframes bl-rg-${kind}-w${i}{${head}${pct(end)}{width:100%;opacity:1}90%{width:100%;opacity:1}97%,100%{width:100%;opacity:0}}`;
}

/** The nib: along each line in its window, back to the margin between lines, lifts off at the end. */
function nibKeyframes(kind, widths, windows) {
  const stops = widths.map((w, i) => {
    const [start, end] = windows[i];
    const top = i * LINE_PITCH;
    return `${pct(start)}{left:0%;top:${top}px;opacity:1}${pct(end)}{left:${w}%;top:${top}px;opacity:1}`;
  });
  const lastTop = (widths.length - 1) * LINE_PITCH;
  const last = widths.at(-1);
  return `@keyframes bl-rg-${kind}-nib{${stops.join('')}88%{left:${last}%;top:${lastTop}px;opacity:1;transform:translate(0,0)}`
    + `95%{left:${last}%;top:${lastTop}px;opacity:0;transform:translate(6px,-10px)}100%{left:0%;top:0px;opacity:0}}`;
}

/** Every kind's keyframes plus the rules that attach them (the CSS the page needs for the ink). */
export function writeCss() {
  return Object.entries(REGEN_LINES).map(([kind, widths]) => {
    const windows = lineWindows(widths.length);
    const cycle = `${cycleSeconds(widths.length)}s`;
    const lines = widths.map((_, i) => lineKeyframes(kind, i, windows[i])).join('\n');
    const attach = widths.map((_, i) => `.bl-rg[data-kind=${kind}] .bl-rg-ln:nth-child(${i + 1}) b{animation-name:bl-rg-${kind}-w${i},bl-rg-sheen}`).join('\n');
    return `${lines}\n${nibKeyframes(kind, widths, windows)}\n${attach}\n`
      + `.bl-rg[data-kind=${kind}] .bl-rg-ln b{animation-duration:${cycle},1.8s}\n`
      + `.bl-rg[data-kind=${kind}] .bl-rg-nib{animation:bl-rg-${kind}-nib ${cycle} cubic-bezier(.45,.05,.55,.95) infinite}`;
  }).join('\n');
}

/** A fountain-pen nib, tip at the bottom left (it writes there). */
export const NIB_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="bl-rg-nib-body" d="M3 21l3.2-8.6L15.6 3a2 2 0 0 1 2.8 0l2.6 2.6a2 2 0 0 1 0 2.8L11.6 17.8z"/>'
  + '<path class="bl-rg-nib-slit" d="M3 21l6.2-6.2"/><circle class="bl-rg-nib-vent" cx="10.4" cy="13.6" r="1.5"/></svg>';

const tag = (kind) => (kind === 'line' ? '' : `<div class="bl-rg-tag" role="status" aria-live="polite"><span class="bl-rg-ic">${NIB_SVG}</span>`
  + '<b class="bl-rg-step">Getting ready</b>'
  + (kind === 'text' ? '<span class="bl-rg-dots" aria-hidden="true"><i></i><i></i><i></i></span><em class="bl-rg-t"></em>' : '')
  + '</div>');

const note = '<div class="bl-rg-note" role="alert"><span class="bl-rg-note-ic" aria-hidden="true">!</span>'
  + '<div><b class="bl-rg-note-t"></b><p class="bl-rg-note-d"></p></div><button type="button" class="bl-rg-note-x">Dismiss</button></div>';

/** The inside of one mask: veil, ink lines with their nib, the step tag, and (text only) the failure note. */
export function maskMarkup(kind) {
  const widths = REGEN_LINES[kind];
  if (!widths) throw new Error(`maskMarkup: unknown kind ${kind}`);
  const lines = widths.map((w, i) => `<span class="bl-rg-ln" style="width:${w}%;--mx:${-(i * 37) % 120}px"><b></b></span>`).join('');
  return `<div class="bl-rg-veil"></div><div class="bl-rg-lines" aria-hidden="true">${lines}<span class="bl-rg-nib">${NIB_SVG}</span></div>`
    + tag(kind) + (kind === 'text' ? note : '');
}
