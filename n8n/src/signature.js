/**
 * The email signature ("Warm regards,\nBookLeaf Author Relations") is rendered from data, never
 * written by the AI: the valediction follows the tone, the name is the admin's sign_off.
 */
export const DEFAULT_SIGN_OFF = 'BookLeaf Author Relations';

const VALEDICTIONS = Object.freeze({ warm: 'Warm regards,', formal: 'Kind regards,', concise: 'Best regards,' });

/**
 * A valediction at a line or sentence start, followed by a comma, a line break or the end, and
 * everything after it. "With regards to your payout" is prose, not a sign-off, so it is kept.
 */
const SIGN_OFF_TAIL = new RegExp(
  '(?:^|\\n|(?<=[.!?])[ \\t]+)[ \\t]*(?:(?:warm(?:est)?|kind|best|with (?:warm|kind|best))\\s+regards|regards|' +
    'yours sincerely|yours truly|sincerely|best wishes|warm wishes)[ \\t]*(?:,|\\n|$)[\\s\\S]*$',
  'i',
);

/**
 * @param {string} [tone] warm | formal | concise @param {string} [signOff] '' = brand default
 * @returns {{valediction:string, name:string}}
 */
export function signatureFor(tone, signOff) {
  const name = typeof signOff === 'string' && signOff.trim() ? signOff.trim() : DEFAULT_SIGN_OFF;
  return { valediction: VALEDICTIONS[tone] ?? VALEDICTIONS.warm, name };
}

/**
 * Removes a sign-off the AI (or an editor) wrote at the end of the closing, so the data-rendered
 * signature is the only one.
 * @param {string} text @param {string[]} [names] extra signature names to drop when left on their own line
 * @returns {string}
 */
export function stripSignature(text, names = []) {
  let out = String(text ?? '').replace(SIGN_OFF_TAIL, '').trimEnd();
  for (const name of [DEFAULT_SIGN_OFF, ...names].filter(Boolean)) {
    const lines = out.split('\n');
    if (lines.length > 1 && lines.at(-1).trim().toLowerCase() === name.toLowerCase()) out = lines.slice(0, -1).join('\n').trimEnd();
  }
  return out.trim();
}
