import { SWEEP_STUCK } from '../src/pipeline/sql.js';
import { pg, schedule } from './lib/nodes.mjs';

/** Every 5 minutes: a job still QUEUED/PROCESSING after 10 minutes becomes FAILED (TIMEOUT). */
const nodes = [schedule('Every 5 Minutes', 5), pg('Sweep Stuck Jobs', SWEEP_STUCK, null)];
export default { name: 'BookLeaf - Stuck Job Sweeper', nodes, edges: [['Every 5 Minutes', 'Sweep Stuck Jobs']] };
