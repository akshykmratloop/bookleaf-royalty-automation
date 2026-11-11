import { SWEEP_STUCK } from '../src/pipeline/sql.js';
import { pg, schedule } from './lib/nodes.mjs';
import { TUNING } from './lib/tuning.mjs';

/**
 * Every minute (TUNING): a job still QUEUED/PROCESSING after the stuck_job_minutes setting becomes
 * FAILED (TIMEOUT). Runs that find nothing are cheap; only failed runs are saved, so the executions
 * list is not buried under 1,440 sweeps a day.
 */
const every = TUNING.sweepEveryMinutes === 1 ? 'Every Minute' : `Every ${TUNING.sweepEveryMinutes} Minutes`;
const nodes = [schedule(every, TUNING.sweepEveryMinutes), pg('Sweep Stuck Jobs', SWEEP_STUCK, null)];
export default {
  name: 'BookLeaf - Stuck Job Sweeper', nodes, edges: [[every, 'Sweep Stuck Jobs']], settings: { saveDataSuccessExecution: 'none' },
};
