import { failure } from './errors.js';
import { isEmail } from './config.js';

/**
 * Where the email goes. NEVER the author's own (dataset) address: the request's demo inbox if it is
 * a valid email, else the server's DEFAULT_DEMO_INBOX, else the job fails with NO_RECIPIENT.
 * @param {{demo_inbox:string|null}} request validated request
 * @param {{defaultDemoInbox:string}} config
 * @param {string|null} authorEmail the dataset address, refused even if configured as the inbox
 * @returns {{ok:true, recipient:string}|import('./errors.js').Failure}
 */
export function recipientFor(request, config, authorEmail) {
  const candidate = isEmail(request.demo_inbox) ? request.demo_inbox : config.defaultDemoInbox;
  if (!isEmail(candidate)) return failure('NO_RECIPIENT', 'Set demo_inbox in the request or DEFAULT_DEMO_INBOX on the server.');
  if (authorEmail && candidate.toLowerCase() === String(authorEmail).toLowerCase())
    return failure('NO_RECIPIENT', "The demo inbox is the author's own address; emails never go to dataset addresses.");
  return { ok: true, recipient: candidate };
}
