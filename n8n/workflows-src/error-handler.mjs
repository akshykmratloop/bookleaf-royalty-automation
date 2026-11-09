import { UPDATE_JOB } from '../src/pipeline/sql.js';
import { code, errorTrigger, http, pg, route } from './lib/nodes.mjs';

/** Error workflow of royalty-summary: an unexpected failure still ends as FAILED (INTERNAL), never stuck. */
const nodes = [
  errorTrigger('Error Trigger'),
  route('Has Execution?', 2, '$json.execution && $json.execution.id ? 1 : 0'),
  http('Fetch Execution', {
    method: 'GET', credential: 'n8nApi', authType: 'httpHeaderAuth', timeoutMs: 15_000, retry: 2, waitMs: 2000,
    url: "={{ ($env.N8N_INTERNAL_URL || 'http://127.0.0.1:5678') + '/api/v1/executions/' + $json.execution.id + '?includeData=true' }}",
  }),
  code('Find Job', 'failedJob', "return main({ trigger: $('Error Trigger').first().json, execution: $json });"),
  route('Job Found?', 2, '$json.route'),
  pg('Mark Job Failed', UPDATE_JOB, 'JSON.stringify($json.update)'),
];
const edges = [
  ['Error Trigger', 'Has Execution?'], ['Has Execution?', 'Fetch Execution', 1], ['Fetch Execution', 'Find Job'],
  ['Find Job', 'Job Found?'], ['Job Found?', 'Mark Job Failed', 1],
];
export default { name: 'BookLeaf - Error Handler', nodes, edges };
