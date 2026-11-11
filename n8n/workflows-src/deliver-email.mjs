import { MARK_EMAIL_FAILED, MARK_SENT, UPDATE_JOB } from '../src/pipeline/sql.js';
import { ifTrue, IS_FALSE, note, NOT_EMPTY, pg, sendEmail, subWorkflowTrigger, withNote } from './lib/nodes.mjs';

/**
 * "BookLeaf - Deliver Email": the one place an email is sent. Royalty Summary (a send job) and Approve
 * Draft (a claimed draft) call it with these inputs (lib/nodes.mjs executeWorkflow maps them).
 */
export const DELIVER_EMAIL = Object.freeze({
  name: 'BookLeaf - Deliver Email',
  inputs: Object.freeze([
    { name: 'job_id', type: 'string' },
    { name: 'email', type: 'object' }, // {from, to, subject, html, text}
    { name: 'drill', type: 'boolean' }, // the email_down drill: send through the unreachable SMTP server
    { name: 'record', type: 'object' }, // more job columns saved with the email (author code, AI usage); may be {}
  ]),
});

const CALL = "$('When Called').first().json";
/** Mark Sending's row: the caller's columns first, so they can never change the job, the stage or the email. */
const SENDING = 'JSON.stringify(Object.assign({}, $json.record, { job_id: $json.job_id, stage: \'sending\', '
  + 'subject: $json.email.subject, html: $json.email.html, text_body: $json.email.text }))';

const ABOUT = [
  '## BookLeaf deliver email',
  'Sends one email for a job and records the result. Called by **Royalty Summary** (a send job, after Render Email) and **Approve Draft** '
  + '(after a draft is claimed) with `job_id`, `email` {from, to, subject, html, text}, `drill` (the email_down drill) and `record` '
  + '(more job columns to save: author code, AI usage).',
  '**Mark Sending** saves the email on the job at stage `sending`, but only while the job is QUEUED/PROCESSING: a job the sweeper '
  + 'has already failed is never emailed, and a failed send keeps its email for the log. **Real SMTP?** is false only for the '
  + 'email_down drill, whose server cannot be reached. **Send Email** tries once. **Mark Sent** / **Mark Failed** '
  + '(`EMAIL_FAILED` with the server\'s message) end the job.',
  'No error workflow here: a failure fails the caller\'s Deliver Email node, and the caller\'s error workflow handles it.',
].join('\n');

const nodes = [
  note('About', ABOUT, 240, { position: [-40, -300], width: 1480 }),
  subWorkflowTrigger('When Called', DELIVER_EMAIL.inputs),
  withNote(pg('Mark Sending', UPDATE_JOB, SENDING, { alwaysOutputData: true }), 'Saves email; stage sending'),
  withNote(ifTrue('Still Running?', '$json.job_id', NOT_EMPTY), 'false: job already ended'),
  withNote(ifTrue('Real SMTP?', `${CALL}.drill`, IS_FALSE), 'false: the email_down drill'),
  withNote(sendEmail('Send Email', 'smtp', `${CALL}.email`), 'One try, never retried'),
  withNote(sendEmail('Send Email (drill: SMTP down)', 'smtpDrill', `${CALL}.email`), 'Unreachable server: fails'),
  pg('Mark Sent', MARK_SENT, `JSON.stringify({ job_id: ${CALL}.job_id, sent_to: ${CALL}.email.to })`),
  withNote(pg('Mark Failed', MARK_EMAIL_FAILED, `JSON.stringify({ job_id: ${CALL}.job_id, error: $json.error })`), 'EMAIL_FAILED + server reply'),
];

const edges = [
  ['When Called', 'Mark Sending'], ['Mark Sending', 'Still Running?'], ['Still Running?', 'Real SMTP?', 0],
  ['Real SMTP?', 'Send Email', 0], ['Real SMTP?', 'Send Email (drill: SMTP down)', 1],
  ['Send Email', 'Mark Sent', 0], ['Send Email', 'Mark Failed', 1],
  ['Send Email (drill: SMTP down)', 'Mark Sent', 0], ['Send Email (drill: SMTP down)', 'Mark Failed', 1],
];

export default { name: DELIVER_EMAIL.name, nodes, edges };
