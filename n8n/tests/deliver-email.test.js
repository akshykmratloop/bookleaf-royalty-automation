import { describe, expect, it } from 'vitest';
import { WORKFLOW_SOURCES } from '../build.mjs';
import { MARK_EMAIL_FAILED, MARK_SENT, UPDATE_JOB } from '../src/pipeline/sql.js';
import { DELIVER_EMAIL } from '../workflows-src/deliver-email.mjs';
import { built, evaluate, nodeOf, ofType, outputsOf, targets } from './built.js';

/** "BookLeaf - Deliver Email": saves the email on the job, sends it once, records SENT or EMAIL_FAILED. */
const WF = 'deliver-email';
const JOB_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const EMAIL = { from: 'Desk <sender@bookleaf.test>', to: 'demo@inbox.test', subject: 'Your summary', html: '<p>₹1</p>', text: '₹1' };
const CALL = { job_id: JOB_ID, email: EMAIL, drill: false, record: { author_code: 'AUTH002', provider: 'anthropic', ai_attempts: 1 } };
const $ = outputsOf({ 'When Called': CALL });
/** The JSON parameter a Postgres node sends, evaluated like n8n would. */
const paramOf = (name, globals) => JSON.parse(evaluate(nodeOf(WF, name).parameters.options.queryReplacement, globals));
const workflowRefs = (wf) => [...JSON.stringify(wf).matchAll(/__WORKFLOW_(.+?)__/g)].map((m) => m[1]);

describe('Deliver Email sub-workflow', () => {
  it('declares typed inputs (job_id, email, drill, record); n8n drops anything else', () => {
    const [trigger] = ofType(WF, 'executeWorkflowTrigger');
    expect(built[WF].name).toBe('BookLeaf - Deliver Email');
    expect(trigger).toMatchObject({ name: 'When Called', typeVersion: 1.1, parameters: { inputSource: 'workflowInputs' } });
    expect(trigger.parameters.workflowInputs.values).toEqual([
      { name: 'job_id', type: 'string' }, { name: 'email', type: 'object' },
      { name: 'drill', type: 'boolean' }, { name: 'record', type: 'object' },
    ]);
    expect(DELIVER_EMAIL.inputs).toEqual(trigger.parameters.workflowInputs.values);
  });
  it('is deployed, and so published, before the workflows that call it', () => {
    const names = WORKFLOW_SOURCES.map((n) => built[n].name);
    WORKFLOW_SOURCES.forEach((n, i) => {
      for (const ref of workflowRefs(built[n])) {
        expect(names.indexOf(ref), `${n} names "${ref}"`).toBeGreaterThanOrEqual(0);
        expect(names.indexOf(ref), `${n} is deployed before "${ref}"`).toBeLessThan(i);
      }
    });
    for (const caller of ['royalty-summary', 'approve-draft']) expect(workflowRefs(built[caller])).toContain(DELIVER_EMAIL.name);
  });
  it('has no error workflow of its own: a failure fails the caller\'s node, whose error workflow handles it', () => {
    expect(built[WF].settings).not.toHaveProperty('errorWorkflow');
    expect(built[WF].settings).toMatchObject({ callerPolicy: 'workflowsFromSameOwner', saveDataErrorExecution: 'all' });
  });
  it('saves the email first, sends only while the job still runs, then records SENT or EMAIL_FAILED', () => {
    expect(targets(WF, 'When Called')).toEqual(['Mark Sending']);
    expect(targets(WF, 'Mark Sending')).toEqual(['Still Running?']);
    expect(targets(WF, 'Still Running?', 0)).toEqual(['Real SMTP?']);
    expect(targets(WF, 'Still Running?', 1)).toEqual([]);
    expect(targets(WF, 'Real SMTP?', 0)).toEqual(['Send Email']);
    expect(targets(WF, 'Real SMTP?', 1)).toEqual(['Send Email (drill: SMTP down)']);
    for (const send of ['Send Email', 'Send Email (drill: SMTP down)']) {
      expect(targets(WF, send, 0), send).toEqual(['Mark Sent']);
      expect(targets(WF, send, 1), send).toEqual(['Mark Failed']);
    }
    expect(nodeOf(WF, 'Mark Sending')).toMatchObject({ alwaysOutputData: true, parameters: { query: UPDATE_JOB } });
    expect(nodeOf(WF, 'Mark Sent').parameters.query).toBe(MARK_SENT);
    expect(nodeOf(WF, 'Mark Failed').parameters.query).toBe(MARK_EMAIL_FAILED);
  });
  it('Mark Sending writes the email and the caller\'s columns at stage sending; the record cannot change the job, stage or email', () => {
    const record = { ...CALL.record, job_id: 'f'.repeat(36), stage: 'sent', subject: 'other', html: 'other' };
    expect(paramOf('Mark Sending', { $json: { ...CALL, record } })).toEqual({
      ...CALL.record, job_id: JOB_ID, stage: 'sending', subject: EMAIL.subject, html: EMAIL.html, text_body: EMAIL.text,
    });
    expect(paramOf('Mark Sending', { $json: { ...CALL, record: {} } })).toEqual({
      job_id: JOB_ID, stage: 'sending', subject: EMAIL.subject, html: EMAIL.html, text_body: EMAIL.text,
    });
  });
  it('Mark Sent records the recipient; Mark Failed passes the Send Email error text', () => {
    const row = { job_id: JOB_ID, status: 'PROCESSING', stage: 'sending', error_code: null };
    expect(paramOf('Mark Sent', { $json: row, $ })).toEqual({ job_id: JOB_ID, sent_to: EMAIL.to });
    const error = 'connect ECONNREFUSED 127.0.0.1:9';
    expect(paramOf('Mark Failed', { $json: { ...row, error }, $ })).toEqual({ job_id: JOB_ID, error });
  });
  it('asks its two questions with IF 2.2 nodes (filter version 2, strict types); true is the happy path', () => {
    const check = (name) => nodeOf(WF, name).parameters.conditions;
    for (const name of ['Still Running?', 'Real SMTP?']) {
      expect(nodeOf(WF, name), name).toMatchObject({ type: 'n8n-nodes-base.if', typeVersion: 2.2 });
      expect(check(name).options, name).toEqual({ caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 });
      expect(check(name).combinator, name).toBe('and');
    }
    expect(check('Still Running?').conditions).toMatchObject([
      { leftValue: '={{ $json.job_id }}', operator: { type: 'string', operation: 'notEmpty', singleValue: true } },
    ]);
    expect(check('Real SMTP?').conditions).toMatchObject([
      { leftValue: "={{ $('When Called').first().json.drill }}", operator: { type: 'boolean', operation: 'false', singleValue: true } },
    ]);
  });
  it('explains the non-obvious nodes on the canvas, in notes short enough to show whole (about 30 characters)', () => {
    for (const name of ['Mark Sending', 'Still Running?', 'Real SMTP?', 'Send Email', 'Send Email (drill: SMTP down)', 'Mark Failed']) {
      expect(nodeOf(WF, name), name).toMatchObject({ notesInFlow: true, notes: expect.stringMatching(/\w/) });
    }
    for (const wf of WORKFLOW_SOURCES) {
      for (const n of built[wf].nodes.filter((x) => x.notesInFlow)) expect(n.notes.length, `${wf}/${n.name}`).toBeLessThanOrEqual(28);
    }
  });
  it('reads left to right: the happy path on one row, the drill and the failure below it', () => {
    const y = (name) => nodeOf(WF, name).position[1];
    const happy = ['When Called', 'Mark Sending', 'Still Running?', 'Real SMTP?', 'Send Email', 'Mark Sent'];
    expect(happy.map(y)).toEqual(happy.map(() => 0));
    const x = happy.map((name) => nodeOf(WF, name).position[0]);
    expect(x).toEqual([...x].sort((a, b) => a - b));
    for (const name of ['Send Email (drill: SMTP down)', 'Mark Failed']) expect(y(name), name).toBeGreaterThan(0);
    const about = nodeOf(WF, 'About');
    expect(about.position[1] + about.parameters.height, 'the About note ends above the nodes').toBeLessThan(0);
  });
});

describe('Send Email', () => {
  it('only Deliver Email emails authors (the error handler only alerts alert_email), and no email node retries', () => {
    const all = WORKFLOW_SOURCES.flatMap((wf) => ofType(wf, 'emailSend').map((n) => ({ wf, n })));
    expect(all.map(({ wf, n }) => `${wf}/${n.name}`)).toEqual(['error-handler/Send Alert', `${WF}/Send Email`, `${WF}/Send Email (drill: SMTP down)`]);
    for (const { n } of all) expect(n, n.name).toMatchObject({ retryOnFail: false });
    const sends = all.filter(({ wf }) => wf === WF);
    for (const { n } of sends) {
      expect(n, n.name).toMatchObject({ retryOnFail: false, onError: 'continueErrorOutput' });
      expect(n, n.name).not.toHaveProperty('maxTries');
      expect(n.parameters.toEmail, n.name).toBe("={{ $('When Called').first().json.email.to }}");
    }
  });
});
