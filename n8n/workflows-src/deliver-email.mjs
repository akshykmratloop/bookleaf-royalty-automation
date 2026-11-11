import { MARK_EMAIL_FAILED, MARK_SENT, UPDATE_JOB } from '../src/pipeline/sql.js';
import { ifTrue, IS_FALSE, NOT_EMPTY, pg, sendEmail, subWorkflowTrigger, withNote } from './lib/nodes.mjs';

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
  ['When Called', 'Mark Sending'], ['Mark Sending', 'Still Running?'], ['Still Running?', 'Real SMTP?', 'true'],
  ['Real SMTP?', 'Send Email', 'true'], ['Real SMTP?', 'Send Email (drill: SMTP down)', 'false'],
  ['Send Email', 'Mark Sent'], ['Send Email', 'Mark Failed', 'error'],
  ['Send Email (drill: SMTP down)', 'Mark Sent'], ['Send Email (drill: SMTP down)', 'Mark Failed', 'error'],
];

/** The send path is row 0, left to right; the drill send and Mark Failed sit below. */
const grid = {
  'When Called': [0, 0], 'Mark Sending': [1, 0], 'Still Running?': [2, 0],
  'Real SMTP?': [3, 0], 'Send Email': [4, 0], 'Send Email (drill: SMTP down)': [4, 1],
  'Mark Sent': [5, 0], 'Mark Failed': [5, 1],
};
const sections = [
  { title: 'Save', text: 'The email goes on the job first; an ended job is never emailed.', nodes: ['When Called', 'Mark Sending', 'Still Running?'] },
  { title: 'Send once', text: 'One try, never retried.', nodes: ['Real SMTP?', 'Send Email', 'Send Email (drill: SMTP down)'] },
  { title: 'Record', text: 'SENT or EMAIL_FAILED.', nodes: ['Mark Sent', 'Mark Failed'] },
];

export default { name: DELIVER_EMAIL.name, nodes, edges, grid, sections, about: ABOUT };
