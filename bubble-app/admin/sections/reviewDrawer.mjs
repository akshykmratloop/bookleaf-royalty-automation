// Review drawer for one draft: edit the subject and wording, change tone/length and regenerate,
// check the edits against the records, then approve & send (or discard). Left: the editor.
// Right: the preview and the fact-check result. While n8n is still writing, it shows live progress.
import { chain, f, op, text, state, groupData, optionValue } from '../expr.mjs';
import { group, row, card, label, button, input, multiline, html, popup, showWhen, withStates, withHtmlId, grow } from '../ui.mjs';
import { T, TONES, fill, border, pad, font, sideBorder } from '../theme.mjs';
import { popupScroll, centred, REVIEW_BODY_HTML_ID } from '../popupStyle.mjs';
import { PAGE } from '../queries.mjs';
import { pill, sendBadge } from './badge.mjs';
import { progress, isLive } from './progress.mjs';
import { TONES_CHOICES, LENGTHS } from './emailSettings.mjs';

const log = (...ops) => chain(groupData('ad_pop_rev'), ...ops);
const st = (name) => state(PAGE, name);
const statusIs = (v) => log(f.option('status', 'sendstatus'), op('equals', { args: optionValue('sendstatus', v) }));
const checked = () => chain(st('rv_checked'), op('equals', { args: 'yes' }));
const failedCheck = () => chain(st('rv_issues'), op('is_not_empty'));

/** The tone/length chosen in the drawer, falling back to the draft's own. */
export const rvTone = () => chain(st('rv_tone'), op('defaulting_to', { args: log(f.text('tone'), op('defaulting_to', { args: 'warm' })) }));
export const rvLength = () => chain(st('rv_len'), op('defaulting_to', { args: log(f.text('length'), op('defaulting_to', { args: 'standard' })) }));

function miniChip(id, caption, selected) {
  return withStates(button(id, caption, 'ghost', { ...pad(5, 12), ...border(T.border, 999), ...font(12.5, 700, T.text2) }), [
    { when: selected, set: { ...fill(T.brandSoft), border_color: T.brand, font_color: T.brandInk } },
  ]);
}

function styleBar() {
  const is = (expr, v) => chain(expr, op('equals', { args: v }));
  return card('ad_rv_style', [
    row('ad_rv_style_r1', [
      label('ad_rv_tone_l', 'TONE', 'micro', { width: 56, single_width: true, min_width_css: '56px', vert_alignment: 'center' }),
      ...TONES_CHOICES.map(([k, cap]) => miniChip(`ad_rv_tone_${k}`, cap, is(rvTone(), k))),
      label('ad_rv_len_l', 'LENGTH', 'micro', { width: 68, single_width: true, min_width_css: '68px', padding_left: 12, vert_alignment: 'center' }),
      ...LENGTHS.map(([k, cap]) => miniChip(`ad_rv_len_${k}`, cap, is(rvLength(), k))),
    ], { gap: 6 }),
    row('ad_rv_style_r2', [
      input('ad_rv_note', 'Optional guidance for a new draft (style only)', grow({ min_width_css: '200px' })),
      button('ad_rv_regen', 'Regenerate draft', 'secondary', { ...pad(10, 16), min_height_css: '40px' }),
    ], { gap: 8 }),
  ], { gap: 10, props: { ...fill(T.panel2), ...pad(12, 14) } });
}

function editor() {
  return group('ad_rv_edit', [
    label('ad_rv_subj_l', 'SUBJECT', 'micro'),
    input('ad_rv_subj', 'Subject', { content: text(log(f.text('subject'))), min_width_css: '0px' }),
    label('ad_rv_body_l', 'EMAIL TEXT', 'micro'),
    withHtmlId(multiline('ad_rv_body', 'The email text', text(log(f.text('edit_text'))), { height: 380, min_height_css: '380px' }), REVIEW_BODY_HTML_ID),
    label('ad_rv_hint', 'Keep the line [FIGURES TABLE] where the table should go: the table and the payout date are built from the records, so they cannot be edited by mistake.', 'hint'),
  ], { gap: 6, props: grow({ min_width_css: '340px' }) });
}

function preview() {
  const shown = (...parts) => html('ad_rv_prev', text('<div class="bl-mail">', ...parts, '</div>'));
  const prev = withStates(shown(log(f.text('email_html'))), [{ when: checked(), set: { html: text('<div class="bl-mail">', st('rv_preview'), '</div>') } }]);
  return group('ad_rv_right', [
    row('ad_rv_checkrow', [
      centred(pill('ad_rv_figs', text(log(f.num('figures_verified')), ' figures verified'), 'success', [{ when: failedCheck(), tone: 'danger', text: text('Check failed') }])),
      label('ad_rv_model', text(log(f.text('model')), ' · $', log(f.num('cost_usd'), op('format_number', { properties: { formatting_type: 'number', decimal_place: 4 }, slidable: true }))), 'hint', grow({ vert_alignment: 'center' })),
    ], { gap: 10, props: { min_height_css: '26px' } }),
    showWhen(html('ad_rv_issues', text('<div class="bl-issues">', st('rv_issues'), '</div>'), { ...fill(TONES.danger[1]), ...border(TONES.danger[1], 12), ...pad(10, 12) }), failedCheck()),
    showWhen(label('ad_rv_ok', 'Your edits passed the fact check. The preview shows exactly what will be sent.', font(12.5, 700, TONES.success[0])), chain(checked(), op('and_', { args: chain(st('rv_issues'), op('is_empty')) }))),
    prev,
  ], { gap: 10, props: grow({ min_width_css: '360px' }) });
}

function footer() {
  return row('ad_rv_foot', [
    button('ad_rv_discard', 'Discard draft', 'danger'),
    group('ad_rv_foot_fill', [], { props: grow({ min_height_css: '1px' }) }),
    button('ad_rv_check', 'Check my edits', 'secondary'),
    button('ad_rv_approve', 'Approve & send', 'primary'),
  ], { gap: 10, props: { ...sideBorder('top'), padding_top: 16 } });
}

/** Fixed header: title, status and Close stay in view while the middle scrolls. */
function header() {
  return row('ad_rv_head', [
    group('ad_rv_id', [
      label('ad_rv_title', text('Royalty email for ', log(f.thing('author', 'author'), f.text('name'))), 'h1'),
      label('ad_rv_sub', 'Read it, change anything you like, then approve. Every figure is checked again before it is sent.', 'sub'),
    ], { gap: 2, props: grow() }),
    centred(sendBadge('ad_rv_badge', log(f.option('status', 'sendstatus'), op('display')))),
    button('ad_rv_close', 'Close', 'ghost'),
  ], { gap: 12 });
}

export function reviewPopup() {
  const ready = statusIs('Draft ready');
  // Header and footer stay put; only ad_rv_scroll scrolls (popupStyle.mjs caps the pop-up at the window height).
  return popup('ad_pop_rev', 'notificationlog', [
    header(),
    popupScroll('ad_rv_scroll', [
      showWhen(card('ad_rv_live', [label('ad_rv_live_t', 'n8n is writing this email', font(13, 800, T.brandInk)), progress('ad_rv_prog', log)], { gap: 6, props: { ...fill(T.brandSoft), ...border(T.brandSoft, 14) } }), isLive(log)),
      showWhen(styleBar(), ready),
      showWhen(row('ad_rv_body_row', [editor(), preview()], { gap: 16, props: { vert_alignment: 'flex-start' } }), ready),
      showWhen(html('ad_rv_final', text('<div class="bl-mail">', log(f.text('email_html')), '</div>')), statusIs('Sent')),
      showWhen(label('ad_rv_err', text(log(f.text('error'))), font(13, 700, TONES.danger[0])), statusIs('Failed')),
    ]),
    showWhen(footer(), ready),
  ], 1120);
}
