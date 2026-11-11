import { failure } from './errors.js';
import { isEmail } from '../validate-fields.js';

/**
 * Where the email goes. NEVER the author's own (dataset) address: the request's demo inbox if it is
 * a valid email, else the default_demo_inbox setting, else the job fails with NO_RECIPIENT.
 * @param {{demo_inbox:string|null}} request validated request
 * @param {{default_demo_inbox:string}} settings
 * @param {string|null} authorEmail the dataset address, refused even if configured as the inbox
 * @returns {{ok:true, recipient:string}|import('./errors.js').Failure}
 */
export function recipientFor(request, settings, authorEmail) {
  const candidate = isEmail(request.demo_inbox) ? request.demo_inbox : settings.default_demo_inbox;
  if (!isEmail(candidate)) return failure('NO_RECIPIENT', 'Set demo_inbox in the request or the default_demo_inbox setting.');
  if (authorEmail && candidate.toLowerCase() === String(authorEmail).toLowerCase())
    return failure('NO_RECIPIENT', "The demo inbox is the author's own address; emails never go to dataset addresses.");
  return { ok: true, recipient: candidate };
}
