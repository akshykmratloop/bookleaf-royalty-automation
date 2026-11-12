// Email preview popup (a sent email exactly as delivered) and the live "in progress" strip shown
// at the top of every view while n8n is working on any email.
import { chain, f, op, parent, search, text, sorted, groupData, optionValue } from '../expr.mjs';
import { group, row, card, label, button, html, list, thingGroup, popup, showWhen, grow } from '../ui.mjs';
import { T, fill, border, pad, font, sideBorder } from '../theme.mjs';
import { progress } from './progress.mjs';
import { popupScroll } from '../popupStyle.mjs';

export function emailPopup() {
  const l = (...ops) => chain(groupData('ad_pop_mail'), ...ops);
  return popup('ad_pop_mail', 'notificationlog', [
    row('ad_pm_head', [
      group('ad_pm_id', [
        label('ad_pm_subj', text(l(f.text('subject'))), 'h2'),
        label('ad_pm_meta', text('To ', l(f.text('sent_to')), ' · ', l(f.num('figures_verified')), ' figures verified · ', l(f.text('model'))), 'hint'),
      ], { gap: 2, props: grow() }),
      button('ad_pm_close', 'Close', 'ghost'),
    ], { gap: 12 }),
    // Only ad_pm_scroll scrolls; the subject line and Close stay in view.
    popupScroll('ad_pm_scroll', [html('ad_pm_html', text('<div class="bl-mail">', l(f.text('email_html')), '</div>'))]),
  ], 780);
}

const liveLogs = () => chain(search('notificationlog', [
  ['status_option_sendstatus', 'not equal', optionValue('sendstatus', 'Sent')],
  ['status_option_sendstatus', 'not equal', optionValue('sendstatus', 'Failed')],
  ['status_option_sendstatus', 'not equal', optionValue('sendstatus', 'Duplicate')],
  ['status_option_sendstatus', 'not equal', optionValue('sendstatus', 'Draft ready')],
  ['status_option_sendstatus', 'not equal', optionValue('sendstatus', 'Discarded')],
]), sorted('Created Date', false));

function liveRow() {
  const p = (...ops) => chain(parent(), ...ops);
  return thingGroup('ad_live_row', 'notificationlog', parent(), [
    label('ad_live_who', text(p(f.thing('author', 'author'), f.text('name'))), 'strong', { width: 170, single_width: true, min_width_css: '170px' }),
    group('ad_live_prog_g', [progress('ad_live_prog', p)], { props: grow() }),
  ], { layout: 'row', gap: 12, props: { ...sideBorder('top'), ...pad(8, 0), vert_alignment: 'center' } });
}

/** Shown at the top of every view while any email is queued or being written. */
export function liveStrip() {
  const n = chain(liveLogs(), op('count'));
  return showWhen(card('ad_live', [
    row('ad_live_head', [
      label('ad_live_h', text('In progress · ', n), font(13, 800, T.brandInk), grow()),
      label('ad_live_n', 'Steps update live; the timer shows how long each email has taken so far.', 'hint'),
    ], { gap: 8 }),
    list('ad_live_rg', 'notificationlog', chain(liveLogs(), op('limit_to', { args: 10 })), liveRow()),
  ], { gap: 6, props: { ...fill(T.brandSoft), ...border(T.brandSoft, 16), ...pad(14, 18) } }), chain(n, op('greater_than', { args: 0 })));
}
