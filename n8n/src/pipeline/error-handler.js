import { failure, MAX_ERROR_LENGTH } from './errors.js';
import { UUID } from './ids.js';

/** Nodes of royalty-summary whose output carries the job id, most reliable first. */
export const JOB_ID_NODES = Object.freeze(['Insert Job', 'Prepare Job']);

function jobIdIn(runs) {
  for (const run of runs ?? []) {
    for (const item of run?.data?.main?.flat() ?? []) {
      const id = item?.json?.job_id ?? item?.json?.job?.job_id;
      if (typeof id === 'string' && UUID.test(id)) return id;
    }
  }
  return null;
}

/**
 * Finds the job id in a failed execution (n8n public API, includeData=true).
 * @param {unknown} execution @returns {string|null}
 */
export function jobIdFromExecution(execution) {
  const runData = execution?.data?.resultData?.runData;
  if (!runData || typeof runData !== 'object') return null;
  for (const name of JOB_ID_NODES) {
    const id = jobIdIn(runData[name]);
    if (id) return id;
  }
  return null;
}

/**
 * The FAILED row written by the error workflow.
 * @param {string} jobId @param {{execution?:{lastNodeExecuted?:string, error?:{message?:string}}}} trigger Error Trigger item
 */
export function internalFailureUpdate(jobId, trigger) {
  const node = trigger?.execution?.lastNodeExecuted ?? 'unknown node';
  const msg = trigger?.execution?.error?.message ?? 'no message';
  const f = failure('INTERNAL', `Node "${node}": ${msg}`);
  return { job_id: jobId, status: 'FAILED', error_code: f.code, error: f.message.slice(0, MAX_ERROR_LENGTH) };
}
