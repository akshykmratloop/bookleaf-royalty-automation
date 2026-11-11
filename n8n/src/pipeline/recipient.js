import { failure } from './errors.js';
import { isEmail } from '../validate-fields.js';

/** @param {string|null|undefined} s @returns {string} an address compared case-insensitively, without spaces */
const key = (s) => String(s ?? '').trim().toLowerCase();

/**
 * The configured inboxes: default_demo_inbox first, then allowed_demo_inboxes. Trimmed, non-empty.
 * @param {{default_demo_inbox:string, allowed_demo_inboxes:readonly string[]}} settings @returns {string[]}
 */
const configuredInboxes = (settings) => [settings.default_demo_inbox, ...(settings.allowed_demo_inboxes ?? [])]
  .map((s) => String(s ?? '').trim())
  .filter(isEmail);

/**
 * Where the email goes: only ever a configured demo inbox, NEVER the author's own (dataset) address.
 * A request's demo_inbox is used when it equals (ignoring case and spaces) default_demo_inbox or one of
 * allowed_demo_inboxes, and the configured spelling is used. Any other address is refused
 * (RECIPIENT_NOT_ALLOWED), never redirected; no demo_inbox means default_demo_inbox; none at all is
 * NO_RECIPIENT. The refusal names the settings, never an address.
 * @param {{demo_inbox:string|null}} request validated request
 * @param {{default_demo_inbox:string, allowed_demo_inboxes:readonly string[]}} settings
 * @param {string|null} authorEmail the dataset address, refused even if configured as an inbox
 * @returns {{ok:true, recipient:string}|import('./errors.js').Failure}
 */
export function recipientFor(request, settings, authorEmail) {
  const asked = key(request.demo_inbox);
  const candidate = asked ? configuredInboxes(settings).find((inbox) => key(inbox) === asked) : settings.default_demo_inbox;
  if (asked && !candidate)
    return failure('RECIPIENT_NOT_ALLOWED', 'Use the default_demo_inbox setting, or add the address to the allowed_demo_inboxes setting.');
  if (!isEmail(candidate)) return failure('NO_RECIPIENT', 'Set demo_inbox in the request or the default_demo_inbox setting.');
  if (authorEmail && key(candidate) === key(authorEmail))
    return failure('NO_RECIPIENT', "The demo inbox is the author's own address; emails never go to dataset addresses.");
  return { ok: true, recipient: candidate };
}
