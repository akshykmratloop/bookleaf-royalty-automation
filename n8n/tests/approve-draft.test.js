import { describe, expect, it } from 'vitest';
import { APPROVE_ACTIONS } from '../src/pipeline/approve.js';
import { CLAIM_DRAFT, DISCARD_DRAFT, SELECT_DRAFT } from '../src/pipeline/sql-approve.js';
import { built, evaluate, nodeOf, outputsOf, targets } from './built.js';

/** "BookLeaf - Approve Draft": check, send or discard a draft; every business answer is HTTP 200. */
const WF = 'approve-draft';
const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const working = built[WF].nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote');
const short = (n) => n.type.replace('n8n-nodes-base.', '');
const DECIDED = { response: { ok: true, job_id: ID, status: 'DISCARDED' }, fallback: { ok: false, job_id: ID, error_code: 'NOT_A_DRAFT' } };
/** A Respond node's status and body, evaluated like n8n for this item. */
function answer(name, $json) {
  const p = nodeOf(WF, name).parameters;
  const g = { $json, $: outputsOf({ Decide: DECIDED }) };
  return { status: evaluate(p.options.responseCode, g), body: evaluate(p.responseBody, g) };
}

describe('approve-draft shape', () => {
  it('has 20 working nodes: 3 Code, 3 IF, 1 Switch, 4 Postgres, 7 Respond, Deliver Email and the webhook', () => {
    expect(working).toHaveLength(20);
    const counts = working.reduce((acc, n) => ({ ...acc, [short(n)]: (acc[short(n)] ?? 0) + 1 }), {});
    expect(counts).toEqual({ webhook: 1, postgres: 4, code: 3, if: 3, switch: 1, respondToWebhook: 7, executeWorkflow: 1 });
  });
  it('Action is a Rules-mode Switch with the outputs Send (top: the main row), Discard and Answer', () => {
    const action = nodeOf(WF, 'Action');
    expect(action).toMatchObject({ typeVersion: 3.2, parameters: { mode: 'rules' } });
    expect(action.parameters.rules.values.map((r) => [r.outputKey, r.conditions.conditions[0].rightValue])).toEqual([
      ['Send', APPROVE_ACTIONS.SEND], ['Discard', APPROVE_ACTIONS.DISCARD], ['Answer', APPROVE_ACTIONS.ANSWER],
    ]);
    expect(action.parameters.rules.values[0].conditions.conditions[0].leftValue).toBe('={{ $json.action }}');
  });
  it('its two IF 2.2 nodes ask the happy-path question', () => {
    expect(nodeOf(WF, 'Request Valid?').parameters.conditions.conditions[0]).toMatchObject({
      leftValue: '={{ $json.ok }}', operator: { type: 'boolean', operation: 'true', singleValue: true },
    });
    expect(nodeOf(WF, 'Claimed?').parameters.conditions.conditions[0]).toMatchObject({
      leftValue: '={{ $json.job_id }}', operator: { type: 'string', operation: 'notEmpty', singleValue: true },
    });
    for (const name of ['Request Valid?', 'Claimed?']) expect(nodeOf(WF, name), name).toMatchObject({ typeVersion: 2.2 });
  });
});

describe('approve-draft wiring', () => {
  it('settings are checked on their own first: unusable settings get 500 from Respond Rejected', () => {
    expect(targets(WF, 'Load Settings')).toEqual(['Check Settings']);
    expect(targets(WF, 'Check Settings')).toEqual(['Settings OK?']);
    expect([targets(WF, 'Settings OK?', 0), targets(WF, 'Settings OK?', 1)]).toEqual([['Parse Request'], ['Respond Rejected']]);
  });
  it('a valid request loads the draft and Decide picks the action; a bad one is answered by Respond Rejected', () => {
    expect(targets(WF, 'Parse Request')).toEqual(['Request Valid?']);
    expect([targets(WF, 'Request Valid?', 0), targets(WF, 'Request Valid?', 1)]).toEqual([['Load Draft'], ['Respond Rejected']]);
    expect(targets(WF, 'Load Draft')).toEqual(['Decide']);
    expect(nodeOf(WF, 'Load Draft')).toMatchObject({ alwaysOutputData: true, parameters: { query: SELECT_DRAFT } });
    expect(targets(WF, 'Decide')).toEqual(['Action']);
    expect([0, 1, 2, 3].map((i) => targets(WF, 'Action', i))).toEqual([['Claim Draft'], ['Discard Draft'], ['Respond Answer'], ['Respond 500']]);
    expect(nodeOf(WF, 'Action').parameters.options).toEqual({ fallbackOutput: 'extra', renameFallbackOutput: 'Unexpected' });
    expect(answer('Respond 500', { action: 'other' })).toMatchObject({ status: 500, body: { error: { code: 'INTERNAL' } } });
  });
  it('discard: Discard Draft, then one answer whether or not the row was still a draft', () => {
    expect(nodeOf(WF, 'Discard Draft')).toMatchObject({
      alwaysOutputData: true, parameters: { query: DISCARD_DRAFT, options: { queryReplacement: "={{ $('Decide').first().json.params }}" } },
    });
    expect(targets(WF, 'Discard Draft')).toEqual(['Respond Discard']);
    expect(answer('Respond Discard', { job_id: ID, status: 'DISCARDED' })).toEqual({ status: 200, body: DECIDED.response });
    expect(answer('Respond Discard', {})).toEqual({ status: 200, body: DECIDED.fallback });
  });
  it('send: Claim Draft; the click that claimed it is answered and the email goes to Deliver Email; another click is ALREADY_SENT', () => {
    expect(nodeOf(WF, 'Claim Draft')).toMatchObject({
      alwaysOutputData: true, parameters: { query: CLAIM_DRAFT, options: { queryReplacement: "={{ $('Decide').first().json.params }}" } },
    });
    expect(targets(WF, 'Claim Draft')).toEqual(['Claimed?']);
    expect([targets(WF, 'Claimed?', 0), targets(WF, 'Claimed?', 1)]).toEqual([['Respond Sending'], ['Respond Already Sent']]);
    expect(answer('Respond Sending', { job_id: ID, status: 'PROCESSING' })).toEqual({ status: 200, body: DECIDED.response });
    expect(answer('Respond Already Sent', {})).toEqual({ status: 200, body: DECIDED.fallback });
    expect(targets(WF, 'Respond Sending')).toEqual(['Deliver Email']);
  });
  it('answer: Respond Answer sends Decide\'s answer; Respond Rejected the 400/500', () => {
    expect(answer('Respond Answer', { action: 'answer', response: { ok: false, error_code: 'NOT_FOUND' } }))
      .toEqual({ status: 200, body: { ok: false, error_code: 'NOT_FOUND' } });
    expect(answer('Respond Rejected', { ok: false, http_status: 400, response: { error: { code: 'VALIDATION' } } }))
      .toEqual({ status: 400, body: { error: { code: 'VALIDATION' } } });
    for (const r of ['Respond Answer', 'Respond Discard', 'Respond Already Sent', 'Respond Rejected']) expect(targets(WF, r), r).toEqual([]);
  });
});

describe('approve-draft canvas', () => {
  it('reads left to right: the send path on one row, the other answers below it', () => {
    const y = (name) => nodeOf(WF, name).position[1];
    const happy = ['Approve Webhook', 'Load Settings', 'Check Settings', 'Settings OK?', 'Parse Request', 'Request Valid?', 'Load Draft', 'Decide', 'Action',
      'Claim Draft', 'Claimed?', 'Respond Sending', 'Deliver Email'];
    expect(happy.map(y)).toEqual(happy.map(() => 0));
    const x = happy.map((name) => nodeOf(WF, name).position[0]);
    expect(x).toEqual([...x].sort((a, b) => a - b));
    for (const n of working.filter((w) => !happy.includes(w.name))) expect(y(n.name), n.name).toBeGreaterThan(0);
    const about = nodeOf(WF, 'About');
    expect(about.position[1] + about.parameters.height, 'the About note ends above the nodes').toBeLessThan(0);
  });
  it('explains the non-obvious nodes with a note on the canvas', () => {
    for (const name of ['Decide', 'Discard Draft', 'Claim Draft', 'Claimed?', 'Deliver Email']) {
      expect(nodeOf(WF, name), name).toMatchObject({ notesInFlow: true, notes: expect.stringMatching(/\w/) });
    }
  });
});
