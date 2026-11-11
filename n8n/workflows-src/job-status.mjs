import { SELECT_JOBS } from '../src/pipeline/sql.js';
import { code, ifTrue, IS_TRUE, pg, respond, webhook } from './lib/nodes.mjs';

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
  pg('Select Jobs', SELECT_JOBS, '$json.params', { alwaysOutputData: true }),
  code('Shape Jobs', 'respondJobs', `return main({ rows: $input.all().map((i) => i.json), ids: ${PARSED}.ids, includeHtml: ${PARSED}.include_html });`),
  respond('Respond Jobs'),
];
const edges = [
  ['Job Status Webhook', 'Parse Query'], ['Parse Query', 'Query Valid?'], ['Query Valid?', 'Select Jobs', 'true'],
  ['Query Valid?', 'Respond Rejected', 'false'], ['Select Jobs', 'Shape Jobs'], ['Shape Jobs', 'Respond Jobs'],
];
export default {
  name: 'BookLeaf - Job Status', nodes, edges, settings: { saveDataSuccessExecution: 'none' },
  mainRow: ['Job Status Webhook', 'Parse Query', 'Query Valid?', 'Select Jobs', 'Shape Jobs', 'Respond Jobs'],
};
