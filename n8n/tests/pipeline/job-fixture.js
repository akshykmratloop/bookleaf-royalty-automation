import { prepareJob } from '../../src/pipeline/prepare.js';
import { payloadFor } from './fixtures.js';
import { NOW, SETTINGS } from './settings-fixture.js';

/** The id enqueue_royalty_job gave the test job (the database makes job ids; Validate Body never does). */
export const JOB_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

/**
 * A job as it runs after Enqueue Job: Validate Body's job plus the id the database made.
 * @param {string} [code] author code of the payload fixture @param {Object} [over] payload overrides
 */
export function queuedJob(code = 'AUTH002', over = {}) {
  const r = prepareJob(payloadFor(code, over), SETTINGS, NOW);
  if (!r.ok) throw new Error(`queuedJob: the fixture payload was rejected (${r.code})`);
  return { ...r.job, job_id: JOB_ID };
}
