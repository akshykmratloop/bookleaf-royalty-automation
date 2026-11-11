import { describe, expect, it } from 'vitest';
import { afterAi } from '../src/pipeline/after-ai.js';
import { buildContext } from '../src/pipeline/context.js';
import { draftUpdate } from '../src/pipeline/finalize.js';
import { prepareJob } from '../src/pipeline/prepare.js';
import { DELIVER_EMAIL } from '../workflows-src/deliver-email.mjs';
import { anthropicOk } from './pipeline/ai-fixtures.js';
import { payloadFor } from './pipeline/fixtures.js';
import { fixedRandom, NOW, SETTINGS } from './pipeline/settings-fixture.js';
import { built, evaluate, nodeOf, ofType, outputsOf, runCode, targets } from './built.js';

/** royalty-summary and approve-draft hand every email to "BookLeaf - Deliver Email". */
const CALLERS = ['royalty-summary', 'approve-draft'];
const [trigger] = ofType('deliver-email', 'executeWorkflowTrigger');
const DECLARED = trigger.parameters.workflowInputs.values;
const callOf = (wf) => nodeOf(wf, 'Deliver Email');
/** What a caller hands over: its input expressions evaluated with these n8n globals. */
const inputsOf = (wf, globals) => Object.fromEntries(Object.entries(callOf(wf).parameters.workflowInputs.value)
  .map(([name, expr]) => [name, evaluate(expr, globals)]));
/** Each input has the type the trigger declares (n8n's resource mapper checks the same, strictly). */
function expectDeclaredTypes(inputs) {
  expect(Object.keys(inputs)).toEqual(DECLARED.map((d) => d.name));
  for (const { name, type } of DECLARED) {
    expect(typeof inputs[name], name).toBe(type);
    if (type === 'object') expect(inputs[name] !== null && !Array.isArray(inputs[name]), name).toBe(true);
  }
  expect(inputs.email).toEqual({
    from: expect.any(String), to: expect.any(String), subject: expect.any(String), html: expect.any(String), text: expect.any(String),
  });
}

const job = (over) => prepareJob(payloadFor('AUTH002', over), SETTINGS, NOW, fixedRandom).job;
const written = (j) => {
  const ctx = buildContext(j).ctx;
  return { ctx, ai: afterAi({ response: anthropicOk(), ctx, job: j, attempt: 1 }).ai };
};
/** Render Email's item for a job, run through the built Code node. */
function rendered(j) {
  const { ctx, ai } = written(j);
  return runCode(nodeOf('royalty-summary', 'Render Email'), {
    $json: { ai }, $: outputsOf({ 'Build Context': { ctx }, 'Prepare Job': { job: j } }),
  })[0].json;
}

describe('callers of Deliver Email', () => {
  it('each hands its emails to Deliver Email (database source, once, waiting) and sends none itself', () => {
    for (const wf of CALLERS) {
      expect(ofType(wf, 'emailSend'), wf).toEqual([]);
      expect(ofType(wf, 'executeWorkflow').map((n) => n.name), wf).toEqual(['Deliver Email']);
      expect(callOf(wf), wf).toMatchObject({
        typeVersion: 1.2, notesInFlow: true,
        parameters: {
          source: 'database', mode: 'once', options: { waitForSubWorkflow: true },
          workflowId: { __rl: true, mode: 'list', value: `__WORKFLOW_${DELIVER_EMAIL.name}__`, cachedResultName: DELIVER_EMAIL.name },
        },
      });
    }
  });
  it('each maps exactly the inputs the trigger declares, with the same names and types', () => {
    for (const wf of CALLERS) {
      const inputs = callOf(wf).parameters.workflowInputs;
      expect(inputs, wf).toMatchObject({ mappingMode: 'defineBelow', matchingColumns: [], attemptToConvertTypes: false });
      expect(Object.keys(inputs.value), wf).toEqual(DECLARED.map((d) => d.name));
      expect(inputs.schema.map((c) => ({ name: c.id, type: c.type })), wf).toEqual(DECLARED);
      for (const c of inputs.schema) expect(c, `${wf}/${c.id}`).toMatchObject({ displayName: c.id, display: true, required: false });
    }
  });
});

describe('royalty-summary → Deliver Email', () => {
  it('only a send job reaches it; a draft is recorded by Record Result', () => {
    expect(targets('royalty-summary', 'Render Email')).toEqual(['Send Now?']);
    expect(targets('royalty-summary', 'Send Now?', 0)).toEqual(['Deliver Email']);
    expect(targets('royalty-summary', 'Send Now?', 1)).toEqual(['Record Result']);
    expect(targets('royalty-summary', 'Deliver Email')).toEqual([]);
    expect(rendered(job({ delivery: 'draft' }))).toMatchObject({ send: false, update: { status: 'DRAFTED' } });
  });
  it('hands over the rendered email, the drill and the AI bookkeeping; sent_to waits for the send', () => {
    const j = job();
    const item = rendered(j);
    expect(item.send).toBe(true);
    const inputs = inputsOf('royalty-summary', { $json: item });
    expectDeclaredTypes(inputs);
    expect(inputs).toMatchObject({ job_id: j.job_id, drill: false, email: { to: 'demo@inbox.test', subject: 'Your BookLeaf royalty summary' } });
    expect(inputs.email.html).toContain('₹13,024');
    expect(inputs.record).toMatchObject({ author_code: 'AUTH002', provider: 'anthropic', ai_attempts: 1, cost_usd: expect.any(Number) });
    for (const key of ['job_id', 'status', 'stage', 'sent_to', 'subject', 'html', 'text_body']) expect(inputs.record, key).not.toHaveProperty(key);
    expect(inputsOf('royalty-summary', { $json: rendered(job({ drills: { email_down: true } })) }).drill).toBe(true);
  });
});

describe('approve-draft → Deliver Email', () => {
  const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
  const draftJob = job({ delivery: 'draft' });
  const draft = draftUpdate({ ...written(draftJob), job: draftJob });
  const row = (over = {}) => ({
    job_id: ID, status: 'DRAFTED', stage: 'drafted', tone: draftJob.tone, length: draftJob.length, sign_off: draftJob.sign_off,
    recipient: draftJob.recipient, sections: draft.sections, facts: draft.facts, titles: draft.titles, drills: draftJob.drills, fresh: true, ...over,
  });
  /** Decide's item for a send, run through the built Code node. */
  const decided = (r) => runCode(nodeOf('approve-draft', 'Decide'), {
    $json: r, $: outputsOf({ 'Parse Request': { request: { job_id: ID, action: 'send', subject: 'Edited', body: draft.edit_text }, settings: SETTINGS } }),
  })[0].json;

  it('runs only after the draft is claimed and the webhook is answered', () => {
    expect(targets('approve-draft', 'Claimed?', 1)).toEqual(['Respond Sending']);
    expect(targets('approve-draft', 'Respond Sending')).toEqual(['Deliver Email']);
    expect(targets('approve-draft', 'Deliver Email')).toEqual([]);
  });
  it('hands over the edited email to the stored demo inbox and the stored drill; nothing else to record', () => {
    const d = decided(row());
    expect(d.route).toBe(2);
    const sending = { route: 1, http_status: 200, response: d.response };
    const inputs = inputsOf('approve-draft', { $json: sending, $: outputsOf({ Decide: d }) });
    expectDeclaredTypes(inputs);
    expect(inputs).toMatchObject({ job_id: ID, drill: false, email: { to: 'demo@inbox.test', subject: 'Edited' } });
    expect(inputs.record).toEqual({});
    const drill = decided(row({ drills: { email_down: true } }));
    expect(inputsOf('approve-draft', { $json: sending, $: outputsOf({ Decide: drill }) }).drill).toBe(true);
  });
});
