import { describe, expect, it } from 'vitest';
import { WORKFLOW_SOURCES } from '../build.mjs';
import { TUNING } from '../src/pipeline/tuning.js';
import { ofType } from './built.js';

/**
 * A dropped database connection must not fail a run whose work is safe to repeat. Reads, and writes
 * guarded by the job's status (a second run of the same UPDATE changes nothing more), retry; a write
 * whose second run would answer differently does not: Enqueue Job (a retried insert would come back as
 * a duplicate of itself), Claim Draft and Discard Draft (a retried claim or discard would find the
 * draft already gone and answer ALREADY_SENT / NOT_A_DRAFT).
 */
const RETRIED = [
  'royalty-summary/Load Settings', 'royalty-summary/Mark Processing', 'royalty-summary/Stage: Rewriting', 'royalty-summary/Record Result',
  'deliver-email/Mark Sending', 'deliver-email/Mark Sent', 'deliver-email/Mark Failed',
  'approve-draft/Load Settings', 'approve-draft/Load Draft', 'job-status/Select Jobs', 'error-handler/Fail Job',
];
const NOT_RETRIED = ['royalty-summary/Enqueue Job', 'approve-draft/Claim Draft', 'approve-draft/Discard Draft', 'sweeper/Sweep Stuck Jobs'];

const pgNodes = WORKFLOW_SOURCES.flatMap((wf) => ofType(wf, 'postgres').map((n) => [`${wf}/${n.name}`, n]));

describe('database retries', () => {
  it('every Postgres node is classified: retried or deliberately not', () => {
    expect(pgNodes.map(([k]) => k).sort()).toEqual([...RETRIED, ...NOT_RETRIED].sort());
  });
  it(`safe reads and status-guarded writes try ${TUNING.dbRetries + 1} times, ${TUNING.dbRetryWaitMs} ms apart`, () => {
    for (const [k, n] of pgNodes.filter(([key]) => RETRIED.includes(key))) {
      expect(n, k).toMatchObject({ retryOnFail: true, maxTries: TUNING.dbRetries + 1, waitBetweenTries: TUNING.dbRetryWaitMs });
    }
    expect(TUNING.dbRetries).toBe(2);
  });
  it('writes whose second run would answer differently, and the every-minute sweep, run once', () => {
    for (const [k, n] of pgNodes.filter(([key]) => NOT_RETRIED.includes(key))) expect(n.retryOnFail, k).toBeUndefined();
  });
});
