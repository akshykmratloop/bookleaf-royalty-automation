// Settings: reference date mode, demo inbox, and the failure drills used to show error handling.
import { chain, f, op, text, dateFmt, yesNo } from '../expr.mjs';
import { group, row, label, button, input } from '../ui.mjs';
import { settings, refDate } from '../queries.mjs';

const onOff = (field) => chain(settings(), f.bool(field), op('is_true'), yesNo('ON', 'off'));

function toggle(id, caption, field, note) {
  return row(`${id}_row`, [
    group(`${id}_txt`, [
      label(`${id}_t`, text(caption, ': ', onOff(field)), 'Text_bold_'),
      label(`${id}_n`, note, 'Text_small_'),
    ], { gap: 2, props: { fit_width: false, min_width_css: '0px' } }),
    button(id, 'Switch', 'Button_ghost_'),
  ], { gap: 12 });
}

export const TOGGLES = [
  ['ad_s_today', 'Use today as the reference date', 'use_today', 'Off = statuses as of 31 Dec 2025, the date of the sample data.'],
  ['ad_s_ai', 'Drill: AI provider down', 'drill_ai_down', 'n8n treats the AI as unavailable: the send must end as Failed with a reason.'],
  ['ad_s_mail', 'Drill: email server down', 'drill_email_down', 'The email step fails: the send must end as Failed, nothing is sent.'],
  ['ad_s_data', 'Drill: royalty data unavailable', 'drill_data_down', 'n8n acts as if the royalty data could not be loaded: Failed, no email.'],
];

export function settingsCard() {
  return group('ad_sec_set', [
    label('ad_set_h', 'Settings', 'Text_h2_'),
    group('ad_set_card', [
      label('ad_set_ref', text('Reference date in use: ', chain(refDate(), dateFmt('d mmm yyyy'))), 'Text_body_'),
      row('ad_set_inbox_row', [
        group('ad_set_inbox_txt', [
          label('ad_set_inbox_t', text('Demo inbox: ', chain(settings(), f.text('demo_inbox'))), 'Text_bold_'),
          label('ad_set_inbox_n', 'Every email goes here, never to the authors in the sample data.', 'Text_small_'),
        ], { gap: 2, props: { fit_width: false, min_width_css: '0px' } }),
        input('ad_set_inbox', 'name@example.com', { content_format: 'email' }),
        button('ad_set_inbox_save', 'Save', 'Button_ghost_'),
      ], { gap: 12 }),
      ...TOGGLES.map(([id, caption, field, note]) => toggle(id, caption, field, note)),
    ], { gap: 16, style: 'Group_card_' }),
  ], { gap: 12 });
}
