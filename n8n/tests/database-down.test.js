import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../src/pipeline/errors.js';
import { built, evaluate, nodeOf, ofType, targets } from './built.js';

/**
 * A database failure before a webhook has answered gets the documented error body (503 DB_UNAVAILABLE,
 * retryable), never n8n's unshaped 500: every Postgres node that runs before a Respond node has an
 * error output wired to "Respond 503".
 */
const BEFORE_ANSWER = {
  'royalty-summary': ['Load Settings', 'Enqueue Job'],
  'approve-draft': ['Load Settings', 'Load Draft', 'Discard Draft', 'Claim Draft'],
  'job-status': ['Select Jobs'],
};
const BODY = { error: { code: 'DB_UNAVAILABLE', message: ERROR_CODES.DB_UNAVAILABLE.message, retryable: true } };

describe('database down before the answer', () => {
  it('DB_UNAVAILABLE is a retryable 503', () => {
    expect(ERROR_CODES.DB_UNAVAILABLE).toEqual({ http: 503, retryable: true, message: expect.stringMatching(/database/) });
  });
  it.each(Object.entries(BEFORE_ANSWER))('%s: each Postgres node before the answer sends its errors to Respond 503', (wf, names) => {
    for (const name of names) {
      expect(nodeOf(wf, name), name).toMatchObject({ onError: 'continueErrorOutput' });
      expect(targets(wf, name, 1), name).toEqual(['Respond 503']);
    }
    expect(targets(wf, 'Respond 503')).toEqual([]);
  });
  it.each(Object.keys(BEFORE_ANSWER))('%s: Respond 503 answers the standard error body, whatever the failed item holds', (wf) => {
    const p = nodeOf(wf, 'Respond 503').parameters;
    const $json = { error: { message: 'connect ECONNREFUSED 10.0.0.5:5432' } };
    expect(evaluate(p.options.responseCode, { $json })).toBe(503);
    expect(evaluate(p.responseBody, { $json })).toEqual(BODY);
  });
  it('every other Postgres node runs after the answer, so its failure goes to the error workflow instead', () => {
    const answered = { 'royalty-summary': ['Mark Processing', 'Stage: Rewriting', 'Record Result'] };
    for (const [wf, names] of Object.entries(answered)) {
      const pgNodes = ofType(wf, 'postgres').map((n) => n.name);
      expect(pgNodes.sort()).toEqual([...BEFORE_ANSWER[wf], ...names].sort());
      for (const name of names) expect(nodeOf(wf, name).onError, name).toBeUndefined();
    }
  });
});
