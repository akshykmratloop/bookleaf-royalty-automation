import { SELECT_JOBS } from '../src/pipeline/sql.js';
import { code, ifTrue, IS_TRUE, pg, respond, webhook, withNote } from './lib/nodes.mjs';

/**
 * GET /webhook/royalty-summary/jobs?ids=<id>,<id>[&include=html]: what Bubble polls every few seconds.
 * Reads no settings, and keeps no successful run (saveDataSuccessExecution none): a poll changes nothing,
 * and thousands of saved polls would bury every other execution (and keep each request's headers).
 */
const PARSED = "$('Parse Query').first().json";
const nodes = [
  webhook('Job Status Webhook', 'GET', 'royalty-summary/jobs'),
  code('Parse Query', 'parseQuery', 'return main({ query: $json.query });'),
  ifTrue('Query Valid?', '$json.ok', IS_TRUE),
  respond('Respond Rejected'),
  withNote(pg('Select Jobs', SELECT_JOBS, '$json.params', { alwaysOutputData: true }), 'html only with include=html'),
  code('Shape Jobs', 'respondJobs', `return main({ rows: $input.all().map((i) => i.json), ids: ${PARSED}.ids, includeHtml: ${PARSED}.include_html });`),
  respond('Respond Jobs'),
];
const edges = [
  ['Job Status Webhook', 'Parse Query'], ['Parse Query', 'Query Valid?'], ['Query Valid?', 'Select Jobs', 'true'],
  ['Query Valid?', 'Respond Rejected', 'false'], ['Select Jobs', 'Shape Jobs'], ['Shape Jobs', 'Respond Jobs'],
];
const ABOUT = [
  '## BookLeaf job status',
  'GET /webhook/royalty-summary/jobs?ids=<id>,<id>[&include=html] with header X-BookLeaf-Key (n8n Header Auth). Up to 50 ids; '
  + 'unknown ids come back in `missing`. Successful runs are not saved (Bubble polls every few seconds).',
].join('\n');
const grid = {
  'Job Status Webhook': [0, 0], 'Parse Query': [1, 0], 'Query Valid?': [2, 0], 'Respond Rejected': [3, 1],
  'Select Jobs': [4, 0], 'Shape Jobs': [5, 0], 'Respond Jobs': [6, 0],
};
const sections = [
  { title: 'Intake', text: 'A bad query gets 400.', nodes: ['Job Status Webhook', 'Parse Query', 'Query Valid?', 'Respond Rejected'] },
  { title: 'Answer', text: 'The jobs, in the order asked.', nodes: ['Select Jobs', 'Shape Jobs', 'Respond Jobs'] },
];

export default { name: 'BookLeaf - Job Status', nodes, edges, grid, sections, about: ABOUT, settings: { saveDataSuccessExecution: 'none' } };
