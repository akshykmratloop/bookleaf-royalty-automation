import { SWEEP_STUCK } from '../src/pipeline/sql-failures.js';
import { pg, schedule, withNote } from './lib/nodes.mjs';
import { TUNING } from '../src/pipeline/tuning.js';

/**
 * Every minute (TUNING): a job still QUEUED/PROCESSING after the stuck_job_minutes setting becomes
 * FAILED (EMAIL_UNCERTAIN if it stopped while sending, else TIMEOUT). Runs that find nothing are cheap; only failed runs are saved, so the executions
 * list is not buried under 1,440 sweeps a day.
 */
const every = TUNING.sweepEveryMinutes === 1 ? 'Every Minute' : `Every ${TUNING.sweepEveryMinutes} Minutes`;
const nodes = [schedule(every, TUNING.sweepEveryMinutes), withNote(pg('Sweep Stuck Jobs', SWEEP_STUCK, null), 'TIMEOUT or EMAIL_UNCERTAIN')];
const ABOUT = [
  '## BookLeaf stuck job sweeper',
  'Fails any job still QUEUED/PROCESSING `stuck_job_minutes` (a setting, 10) after it started: EMAIL_UNCERTAIN if it stopped while '
  + 'sending, TIMEOUT otherwise. Drafts are never touched. Only failed sweeps are saved.',
].join('\n');

export default {
  name: 'BookLeaf - Stuck Job Sweeper', nodes, edges: [[every, 'Sweep Stuck Jobs']], settings: { saveDataSuccessExecution: 'none' },
  grid: { [every]: [0, 0], 'Sweep Stuck Jobs': [1, 0] },
  sections: [{ title: 'Sweep', text: 'Every minute; a sweep that finds nothing changes nothing.', nodes: [every, 'Sweep Stuck Jobs'] }],
  about: ABOUT,
};
