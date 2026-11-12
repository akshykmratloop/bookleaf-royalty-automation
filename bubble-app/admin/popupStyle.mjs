// Pop-up layout: every admin pop-up fits the window, with a fixed header, an optional fixed footer,
// and ONE scroll area in the middle. Why CSS is needed: the app shell locks html/body
// (overflow:hidden), and Bubble places a pop-up taller than the window at top:50px and lets the
// *page* scroll to reach the rest. With the page locked, the bottom of a tall pop-up (its buttons)
// could never be reached. POPUP_CSS caps each pop-up at the window height and turns the middle
// group into the scroll area. The integrator adds POPUP_CSS to the page's style layer.
import { group } from './ui.mjs';

/** The middle groups that scroll (one per pop-up). Their element names become their CSS classes. */
export const SCROLL_IDS = ['ad_rv_scroll', 'ad_pa_scroll', 'ad_pm_scroll'];

/** HTML id of the review pop-up's email text box (it grows with its text instead of scrolling). */
export const REVIEW_BODY_HTML_ID = 'ad_rv_body';

const EDGE = 24; // gap between the pop-up and the window edge, top and bottom (px)
const GUTTER = 14; // room for the scrollbar and the 3px focus ring inside the 28px pop-up padding
const scrollers = SCROLL_IDS.map((id) => `.bubble-element.Popup>.${id}`).join(',');
const mails = SCROLL_IDS.map((id) => `.${id} .bl-mail`).join(',');

export const POPUP_CSS = `<style>
.bubble-element.Popup{position:fixed!important;top:${EDGE}px!important;bottom:${EDGE}px!important;margin-top:auto!important;margin-bottom:auto!important;height:fit-content!important;max-height:calc(100vh - ${EDGE * 2}px)!important;overflow:hidden!important;overscroll-behavior:contain}
${scrollers}{flex:1 1 auto!important;min-height:0!important;overflow-x:hidden!important;overflow-y:auto!important;overscroll-behavior:contain;width:auto!important;align-self:stretch!important;margin:-4px -${GUTTER}px!important;padding:4px ${GUTTER}px!important}
${mails}{max-height:none!important}
@supports (field-sizing:content){#${REVIEW_BODY_HTML_ID}{field-sizing:content;height:auto!important;min-height:380px!important;overflow-y:hidden}}
</style>`;

/** The middle of a pop-up: a column that scrolls inside the pop-up (see POPUP_CSS). */
export function popupScroll(id, children, gap = 16) {
  if (!SCROLL_IDS.includes(id)) throw new Error(`popupScroll: ${id} is not in SCROLL_IDS, so it would not scroll`);
  return group(id, children, { gap, props: { fit_width: false, min_width_css: '0px', min_height_css: '0px' } });
}

/** Centres every child of a row vertically (Bubble top-aligns a child unless it says otherwise). */
export function centred(rowElement) {
  const elements = Object.fromEntries(Object.entries(rowElement.elements ?? {})
    .map(([k, c]) => [k, { ...c, properties: { ...c.properties, vert_alignment: 'center' } }]));
  return { ...rowElement, elements };
}
