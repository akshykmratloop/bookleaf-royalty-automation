import { describe, expect, it } from 'vitest';
import { CREDENTIALS, credentialRef } from '../workflows-src/lib/credentials.mjs';
import { FAIL_JOB } from '../src/pipeline/sql-failures.js';
import { built, evaluate, nodeOf, ofType, outputsOf, targets } from './built.js';

/**
 * "BookLeaf - Error Handler": the error workflow of royalty-summary and approve-draft. It fails the job
 * that belongs to the failed execution (by execution_id) and tells alert_email. No n8n API call, no key.
 */
const WF = 'error-handler';
const working = built[WF].nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
const EXECUTION = {
  id: '231', url: 'http://localhost:5678/workflow/abc/executions/231', lastNodeExecuted: 'Build Context', mode: 'webhook',
  error: { message: 'Failure drill: the workflow crashed on purpose.' },
};
const TRIGGER = { execution: EXECUTION, workflow: { id: 'abc', name: 'BookLeaf - Royalty Summary' } };
const ROW = { job_id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', error_code: 'INTERNAL', alert_to: 'ops@inbox.test', alert_from: 'Desk <sender@bookleaf.test>' };
const failParam = (trigger) => JSON.parse(evaluate(nodeOf(WF, 'Fail Job').parameters.options.queryReplacement, { $json: trigger }));
/** Send Alert's fields for one Fail Job row, evaluated like n8n would. */
function alertFor(row, trigger = TRIGGER) {
  const p = nodeOf(WF, 'Send Alert').parameters;
  const globals = { $json: row, $: outputsOf({ 'Error Trigger': trigger }) };
  return Object.fromEntries(['fromEmail', 'toEmail', 'subject', 'text'].map((k) => [k, evaluate(p[k], globals)]));
}

describe('Error Handler workflow', () => {
  it('has 4 working nodes: Error Trigger → Fail Job → Alert Set? → Send Alert, and no Code or HTTP node', () => {
    expect(working.map((n) => [n.name, n.type.replace('n8n-nodes-base.', '')])).toEqual([
      ['Error Trigger', 'errorTrigger'], ['Fail Job', 'postgres'], ['Alert Set?', 'if'], ['Send Alert', 'emailSend'],
    ]);
    expect([targets(WF, 'Error Trigger'), targets(WF, 'Fail Job'), targets(WF, 'Alert Set?', 0), targets(WF, 'Alert Set?', 1)])
      .toEqual([['Fail Job'], ['Alert Set?'], ['Send Alert'], []]);
  });
  it('needs no n8n API key: the credential is gone and nothing calls the n8n API', () => {
    expect(Object.keys(CREDENTIALS)).not.toContain('n8nApi');
    const text = JSON.stringify(built);
    expect(text).not.toMatch(/X-N8N-API-KEY|\/api\/v1|includeData/);
  });
  it('Fail Job runs FAIL_JOB with the failed execution\'s id, node and message', () => {
    expect(nodeOf(WF, 'Fail Job')).toMatchObject({ parameters: { query: FAIL_JOB }, credentials: credentialRef('postgres') });
    expect(failParam(TRIGGER)).toEqual({ execution_id: '231', node: 'Build Context', message: EXECUTION.error.message });
  });
  it('Fail Job copes with a trigger failure (no execution): it matches no job and still reads the alert address', () => {
    expect(failParam({ trigger: { error: { message: 'x' } }, workflow: { name: 'W' } })).toEqual({ execution_id: '', node: '', message: '' });
  });
  it('Alert Set? (IF 2.2) sends only when alert_email is set', () => {
    expect(nodeOf(WF, 'Alert Set?')).toMatchObject({ typeVersion: 2.2 });
    const [c] = nodeOf(WF, 'Alert Set?').parameters.conditions.conditions;
    expect(c).toMatchObject({ leftValue: '={{ $json.alert_to }}', operator: { type: 'string', operation: 'notEmpty' } });
  });
  it('Send Alert writes a plain-text alert from the settings sender to alert_email, naming workflow, execution, node, error and job', () => {
    expect(nodeOf(WF, 'Send Alert')).toMatchObject({ credentials: credentialRef('smtp'), retryOnFail: false, parameters: { emailFormat: 'text' } });
    const a = alertFor(ROW);
    expect(a).toMatchObject({ fromEmail: ROW.alert_from, toEmail: ROW.alert_to, subject: 'BookLeaf alert: BookLeaf - Royalty Summary failed' });
    for (const part of [EXECUTION.url, 'Node: Build Context', `Error: ${EXECUTION.error.message}`, `Job ${ROW.job_id} is now FAILED (INTERNAL).`]) {
      expect(a.text).toContain(part);
    }
  });
  it('a failed alert fails the error workflow\'s run (shown in the executions list), never silently', () => {
    expect(nodeOf(WF, 'Send Alert')).not.toHaveProperty('onError');
    expect(built[WF].settings).toMatchObject({ saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all' });
  });
  it('says when the email may have gone out (EMAIL_UNCERTAIN) and when no job was changed', () => {
    expect(alertFor({ ...ROW, error_code: 'EMAIL_UNCERTAIN' }).text).toMatch(/may or may not have gone out/);
    const none = alertFor({ ...ROW, job_id: null, error_code: null }, { trigger: { error: { message: 'boom' } }, workflow: { name: 'W' } });
    expect(none.text).toContain('No running job belonged to this execution');
    expect(none.text).toContain('Error: boom');
    expect(none.subject).toBe('BookLeaf alert: W failed');
  });
  it('the Error Trigger is n8n\'s own and the error handler has no error workflow of its own', () => {
    expect(ofType(WF, 'errorTrigger')).toHaveLength(1);
    expect(built[WF].settings).not.toHaveProperty('errorWorkflow');
  });
});
