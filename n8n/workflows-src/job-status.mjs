import { SELECT_JOBS } from '../src/pipeline/sql.js';
import { code, pg, respond, route, webhook } from './lib/nodes.mjs';

/** GET /webhook/royalty-summary/jobs?ids=<id>,<id>[&include=html] — what Bubble polls in pull mode. */
const PARSED = "$('Parse Query').first().json";
const nodes = [
  webhook('Job Status Webhook', 'GET', 'royalty-summary/jobs'),
  code('Parse Query', 'parseQuery', 'return main({ query: $json.query });'),
  route('Valid?', 2, '$json.route'),
  respond('Respond Rejected'),
  pg('Select Jobs', SELECT_JOBS, '$json.params', { alwaysOutputData: true }),
  code('Shape Jobs', 'respondJobs', `return main({ rows: $input.all().map((i) => i.json), ids: ${PARSED}.ids, includeHtml: ${PARSED}.include_html });`),
  respond('Respond Jobs'),
];
const edges = [
  ['Job Status Webhook', 'Parse Query'], ['Parse Query', 'Valid?'], ['Valid?', 'Respond Rejected', 0], ['Valid?', 'Select Jobs', 1],
  ['Select Jobs', 'Shape Jobs'], ['Shape Jobs', 'Respond Jobs'],
];
export default { name: 'BookLeaf - Job Status', nodes, edges };
