// Email settings: the defaults every new royalty email uses. Tone, length and guidance shape the
// wording only; the figures always come from the records and are checked before anything is sent.
import { chain, f, op, text } from '../expr.mjs';
import { group, row, card, label, button, input, withStates, hover, grow, fixedWidth } from '../ui.mjs';
import { T, fill, border, pad, font, shadow } from '../theme.mjs';
import { settings } from '../queries.mjs';
import { pageHeader } from './overview.mjs';

export const TONES_CHOICES = [['warm', 'Warm', 'Friendly and personal: the BookLeaf default.'], ['formal', 'Formal', 'Polite and businesslike.'], ['concise', 'Concise', 'Short sentences, straight to the figures.']];
export const LENGTHS = [['short', 'Short', 'About 80–180 words'], ['standard', 'Standard', 'About 150–300 words'], ['detailed', 'Detailed', 'About 250–450 words']];

const setting = (field) => chain(settings(), f.text(field));
/** Empty settings fall back to the defaults n8n uses. */
export const defaultTone = () => chain(setting('email_tone'), op('defaulting_to', { args: 'warm' }));
export const defaultLength = () => chain(setting('email_length'), op('defaulting_to', { args: 'standard' }));

/** A selectable card in a choice row; `selected` is a yes/no expression. */
export function choice(id, caption, note, selected) {
  const c = group(id, [label(`${id}_t`, caption, 'strong'), label(`${id}_n`, note, 'hint')], {
    gap: 4, props: { ...fill(T.panel), ...border(T.border, 12), ...pad(12, 16), ...grow({ min_width_css: '140px' }) },
  });
  return withStates(hover(c, { border_color: T.borderStrong }), [{ when: selected, set: { ...fill(T.brandSoft), border_color: T.brand, ...shadow('soft') } }]);
}

const is = (expr, v) => chain(expr, op('equals', { args: v }));

function reviewToggle() {
  const on = chain(settings(), f.bool('review_first'), op('is_true'));
  return row('ad_es_rev', [
    group('ad_es_rev_txt', [
      label('ad_es_rev_t', 'Review before sending', 'strong'),
      label('ad_es_rev_n', 'On: "Generate & Send" first creates a draft you can read and edit, then you approve it. Off: emails go out as soon as they pass the fact check.', 'hint'),
    ], { gap: 4, props: grow() }),
    withStates(button('ad_es_rev_btn', 'Off', 'secondary', { ...pad(8, 16), ...fixedWidth(64) }), [{ when: on, set: { text: text('On'), ...fill(T.brand), border_color: T.brand, font_color: T.onBrand } }]),
  ], { gap: 16 });
}

function textSetting(id, caption, note, field, placeholder) {
  return group(`${id}_g`, [
    group(`${id}_hd`, [label(`${id}_t`, caption, 'strong'), label(`${id}_n`, note, 'hint')], { gap: 4 }),
    row(`${id}_row`, [
      input(id, placeholder, { ...grow({ min_width_css: '200px' }), content: text(chain(settings(), f.text(field))) }),
      button(`${id}_save`, 'Save', 'secondary'),
    ], { gap: 8 }),
  ], { gap: 8 });
}

export function emailSettingsSection() {
  return group('ad_v_email', [
    pageHeader('ad_es_hdr', 'Email settings', 'Defaults for every new royalty email. You can still change tone and length for a single email while reviewing its draft.'),
    card('ad_es_card', [
      reviewToggle(),
      label('ad_es_tone_h', 'Tone', 'h3'),
      row('ad_es_tones', TONES_CHOICES.map(([k, cap, note]) => choice(`ad_es_tone_${k}`, cap, note, is(defaultTone(), k))), { gap: 12, align: 'stretch' }),
      label('ad_es_len_h', 'Length', 'h3'),
      row('ad_es_lens', LENGTHS.map(([k, cap, note]) => choice(`ad_es_len_${k}`, cap, note, is(defaultLength(), k))), { gap: 12, align: 'stretch' }),
      textSetting('ad_es_note', 'Extra guidance for the AI', 'Style only, up to 300 characters, e.g. "Mention our new Kindle royalty rates are coming soon". It can never change a figure: every amount and date is checked against the records.', 'email_note', 'Optional guidance'),
      textSetting('ad_es_sign', 'Sign-off name', 'Shown under the closing line of every email. Letters and spaces only, up to 60 characters.', 'sign_off', 'BookLeaf Author Relations (default)'),
    ], { gap: 16, props: pad(24) }),
    label('ad_es_safe', 'How the figures stay correct: amounts, dates and counts are computed from the records, the AI writes only the wording, and a checker blocks any email (or edit) that mentions a figure the records do not support.', font(12.5, 600, T.text2)),
  ], { gap: 16 });
}
