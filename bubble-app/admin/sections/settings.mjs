// System & drills: reference date, demo inbox, how Bubble and n8n are connected, and the failure
// drills that prove every error path ends as a clear "Failed" (or, for the primary AI, a fallback).
import { chain, f, op, text, dateFmt } from '../expr.mjs';
import { group, row, card, label, button, input, withStates, grow } from '../ui.mjs';
import { T, TONES, fill, border, pad, font, sideBorder } from '../theme.mjs';
import { settings, refDate } from '../queries.mjs';
import { pageHeader } from './overview.mjs';

const isOn = (field) => chain(settings(), f.bool(field), op('is_true'));

function toggle(id, caption, field, note, danger = true) {
  const on = isOn(field);
  const onLook = danger ? { ...fill(TONES.danger[0]), border_color: TONES.danger[0], font_color: '#ffffff' } : { ...fill(T.brand), border_color: T.brand, font_color: '#ffffff' };
  return row(`${id}_row`, [
    group(`${id}_txt`, [label(`${id}_t`, caption, 'strong'), label(`${id}_n`, note, 'hint')], { gap: 2, props: grow() }),
    withStates(button(id, 'Off', 'secondary', { ...pad(7, 16), min_width_css: '64px' }), [{ when: on, set: { text: text('On'), ...onLook } }]),
  ], { gap: 16, props: { ...sideBorder('bottom'), ...pad(12, 0) } });
}

export const TOGGLES = [
  ['ad_s_today', 'Use today as the reference date', 'use_today', 'Off: statuses as of 31 Dec 2025, the date of the sample data. On: as of today, so every unpaid book becomes overdue.', false],
  ['ad_s_ai', 'Drill: both AI providers down', 'drill_ai_down', 'Anthropic and OpenAI both fail. The email must end as Failed with the reason; nothing is sent.'],
  ['ad_s_primary', 'Drill: primary AI (Anthropic) down', 'drill_primary_down', 'Only Anthropic fails. n8n falls back to OpenAI and the email is still written, checked and sent; the log shows the OpenAI model.'],
  ['ad_s_mail', 'Drill: email server down', 'drill_email_down', 'The SMTP step fails: the email ends as Failed and nothing is delivered.'],
  ['ad_s_data', 'Drill: royalty data unavailable', 'drill_data_down', 'n8n acts as if the author data could not be loaded: Failed, no AI call, no email.'],
];

function facts() {
  const fact = (id, k, v) => row(id, [label(`${id}_k`, k, font(12.5, 700, T.text2), { width: 170, single_width: true, min_width_css: '170px' }), label(`${id}_v`, v, 'body', grow())], { gap: 12 });
  return card('ad_sys_card', [
    label('ad_sys_h', 'How Bubble and n8n are connected', 'h2'),
    fact('ad_sys_1', 'Request', 'Bubble API Connector → n8n webhook, with a private key header that never reaches the browser.'),
    fact('ad_sys_2', 'Result', 'Pull mode: Bubble asks n8n for the job every 3 s. The free plan blocks calls into Bubble, so n8n cannot push.'),
    fact('ad_sys_3', 'Duplicates', 'Same author + same data within 10 minutes returns the existing job: one email, never two.'),
    fact('ad_sys_4', 'Stuck jobs', 'A sweeper in n8n fails anything still running after 10 minutes, with a reason.'),
    fact('ad_sys_5', 'Records', 'Only the newest 100 log entries are kept, to stay inside the free plan\'s 200-record limit.'),
  ], { gap: 10 });
}

export function settingsSection() {
  return group('ad_v_system', [
    pageHeader('ad_sy_hdr', 'System & drills', 'The reference date, the demo inbox, how the two systems talk, and switches that break things on purpose to show the error handling.'),
    card('ad_set_card', [
      label('ad_set_ref', text('Reference date in use: ', chain(refDate(), dateFmt('d mmm yyyy'))), 'h3'),
      group('ad_set_inbox_g', [
        label('ad_set_inbox_t', text('Demo inbox: ', chain(settings(), f.text('demo_inbox'))), 'strong'),
        label('ad_set_inbox_n', 'Every email goes here, never to the authors in the sample data.', 'hint'),
        row('ad_set_inbox_row', [input('ad_set_inbox', 'name@example.com', { content_format: 'email', ...grow() }), button('ad_set_inbox_save', 'Save', 'secondary')], { gap: 8 }),
      ], { gap: 6, props: { ...sideBorder('bottom'), padding_bottom: 12 } }),
      ...TOGGLES.map(([id, caption, field, note, danger]) => toggle(id, caption, field, note, danger !== false)),
    ], { gap: 6, props: pad(24) }),
    facts(),
  ], { gap: 16 });
}
