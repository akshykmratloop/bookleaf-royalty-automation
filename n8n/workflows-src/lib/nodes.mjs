import { sha256Hex } from '../../src/pipeline/sha256.js';
import { credentialRef } from './credentials.mjs';

/**
 * Small constructors for the n8n nodes used by the BookLeaf workflows (n8n 2.x node types and
 * typeVersions, checked against n8nio/n8n:2.45.4). Code nodes carry `entry`/`body`; build.mjs turns
 * them into a self-contained `jsCode`.
 */
const node = (name, type, typeVersion, parameters, extra = {}) => ({ name, type: `n8n-nodes-base.${type}`, typeVersion, parameters, ...extra });

/** A UUID-shaped id that is the same on every build (n8n wants ids; a reproducible build wants no randomness). */
export function stableUuid(text) {
  const h = sha256Hex(text);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** What deploy.mjs swaps for a workflow's id on the instance (build.mjs WORKFLOW_SOURCES deploys it first). */
export const workflowPlaceholder = (name) => `__WORKFLOW_${name}__`;

/**
 * Shows `text` under the node on the canvas (n8n "Display Note in Flow"), for anything a reader would ask
 * about. The canvas shows one line of about 30 characters, so keep it short.
 */
export const withNote = (n, text) => ({ ...n, notes: text, notesInFlow: true });

/** @param {string} name @param {string} entry export of workflows-src/code/entries.js @param {string} body JS run in the node */
export const code = (name, entry, body) => node(name, 'code', 2, { mode: 'runOnceForAllItems', language: 'javaScript' }, { entry, body });

/** Switch in expression mode: `output` evaluates to the output index. */
export const route = (name, outputs, expression) =>
  node(name, 'switch', 3.2, { mode: 'expression', numberOutputs: outputs, output: `={{ ${expression} }}` });

/** Filter options as the n8n 2.45 editor writes them for IF 2.2; without `version`, n8n would run the filter as version 1. */
const FILTER_OPTIONS = Object.freeze({ caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 });
/** True only for the boolean true. */
export const IS_TRUE = Object.freeze({ type: 'boolean', operation: 'true', singleValue: true });
/** n8n tests `!value`: true for false and for a missing value (null, undefined). */
export const IS_FALSE = Object.freeze({ type: 'boolean', operation: 'false', singleValue: true });
/** False for '', null and undefined too (an empty item from alwaysOutputData). */
export const NOT_EMPTY = Object.freeze({ type: 'string', operation: 'notEmpty', singleValue: true });

/** One filter condition, as the n8n 2.45 editor writes it for IF 2.2 and Switch 3.2. */
const filter = (id, left, operator, right = '') => ({
  options: { ...FILTER_OPTIONS },
  conditions: [{ id: stableUuid(id), leftValue: `={{ ${left} }}`, rightValue: right, operator: { ...operator } }],
  combinator: 'and',
});

/**
 * IF 2.2 with one condition: output 0 = true (drawn on top: make it the happy path), 1 = false.
 * @param {string} name @param {string} left expression tested @param {Object} operator IS_TRUE, IS_FALSE or NOT_EMPTY
 */
export const ifTrue = (name, left, operator) => node(name, 'if', 2.2, { conditions: filter(`${name}/condition`, left, operator), options: {} });

/**
 * Switch 3.2 in Rules mode: one named output per case, in order, taken when `left` equals the case's
 * value (no fallback output: nothing else can come).
 * @param {string} name @param {string} left expression tested @param {{output:string, equals:string}[]} cases
 */
export const switchRules = (name, left, cases) => node(name, 'switch', 3.2, {
  mode: 'rules',
  rules: {
    values: cases.map((c) => ({
      conditions: filter(`${name}/${c.output}`, left, { type: 'string', operation: 'equals' }, c.equals),
      renameOutput: true, outputKey: c.output,
    })),
  },
  options: {},
});

/**
 * Webhook answered by a Respond node. n8n checks the X-BookLeaf-Key header itself (Header Auth with
 * the webhookKey credential): a missing or wrong key gets 403 and the workflow never starts.
 */
export const webhook = (name, method, path) => node(name, 'webhook', 2.1, {
  httpMethod: method, path, authentication: 'headerAuth', responseMode: 'responseNode', options: {},
}, { webhookId: `bookleaf-${path.replace(/\W+/g, '-')}`, credentials: credentialRef('webhookKey') });

/** Respond to Webhook with JSON from `$json.response` and the status in `$json.http_status`. */
export const respond = (name, statusExpr = '$json.http_status', bodyExpr = '$json.response') => node(name, 'respondToWebhook', 1.1, {
  respondWith: 'json', responseBody: `={{ ${bodyExpr} }}`, options: { responseCode: `={{ ${statusExpr} }}` },
});

/** Postgres query with ONE JSON parameter ($1::jsonb). */
export const pg = (name, query, paramExpr, extra = {}) => node(name, 'postgres', 2.6, {
  operation: 'executeQuery', query, options: paramExpr ? { queryReplacement: `={{ ${paramExpr} }}` } : {},
}, { credentials: credentialRef('postgres'), ...extra });

/**
 * HTTP Request with a JSON body and a credential. `timeout`: milliseconds, or an expression giving them.
 * `retry` = extra tries after the first.
 * @param {{method:string, url:string, credential:string, authType:string, body?:string, headers?:Object, timeout:number|string, retry?:number, waitMs?:number, errorOutput?:boolean}} o
 */
export function http(name, o) {
  const parameters = {
    method: o.method, url: o.url, authentication: 'genericCredentialType', genericAuthType: o.authType,
    sendHeaders: Boolean(o.headers), headerParameters: { parameters: Object.entries(o.headers ?? {}).map(([k, v]) => ({ name: k, value: v })) },
    sendBody: Boolean(o.body), ...(o.body ? { contentType: 'json', specifyBody: 'json', jsonBody: `={{ ${o.body} }}` } : {}),
    options: { timeout: o.timeout },
  };
  const retry = o.retry ? { retryOnFail: true, maxTries: o.retry + 1, waitBetweenTries: o.waitMs ?? 1000 } : {};
  const onError = o.errorOutput ? { onError: 'continueErrorOutput' } : {};
  return node(name, 'httpRequest', 4.2, parameters, { credentials: credentialRef(o.credential), ...retry, ...onError });
}

/**
 * Send Email (SMTP), one try: when the server's answer is lost, a second try could send twice.
 * @param {{from:string, to:string, subject:string, text:string, html?:string}} fields expressions; no html = plain text
 */
const emailNode = (name, credential, fields, extra) => node(name, 'emailSend', 2.1, {
  resource: 'email', operation: 'send', fromEmail: `={{ ${fields.from} }}`, toEmail: `={{ ${fields.to} }}`,
  subject: `={{ ${fields.subject} }}`, emailFormat: fields.html ? 'both' : 'text', text: `={{ ${fields.text} }}`,
  ...(fields.html ? { html: `={{ ${fields.html} }}` } : {}), options: { appendAttribution: false },
}, { credentials: credentialRef(credential), ...extra, retryOnFail: false });

/**
 * An author's email, HTML and text; a failure goes to the second output as the input item plus
 * `error` (the server's message).
 * @param {string} name @param {string} credential @param {string} [src] expression for the {from,to,subject,html,text} object
 */
export const sendEmail = (name, credential, src = '$json.email') => emailNode(name, credential, {
  from: `${src}.from`, to: `${src}.to`, subject: `${src}.subject`, text: `${src}.text`, html: `${src}.html`,
}, { onError: 'continueErrorOutput' });

/**
 * A plain-text alert. A failure fails the node (and so its run, shown in the executions list).
 * @param {string} name @param {string} credential @param {{from:string, to:string, subject:string, text:string}} fields expressions
 */
export const sendAlert = (name, credential, fields) => emailNode(name, credential, fields, {});

/**
 * Execute Workflow Trigger ("When Executed by Another Workflow") with typed inputs. The caller's
 * Execute Workflow node checks the types; fields that are not declared never reach the workflow.
 * @param {{name:string, type:'string'|'number'|'boolean'|'array'|'object'}[]} inputs
 */
export const subWorkflowTrigger = (name, inputs) => node(name, 'executeWorkflowTrigger', 1.1, {
  inputSource: 'workflowInputs', workflowInputs: { values: inputs.map((i) => ({ name: i.name, type: i.type })) },
});

/** One sub-workflow input in an Execute Workflow node's mapping, as the n8n editor writes it. */
const inputColumn = ({ name, type }) => ({ id: name, displayName: name, required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type });

/**
 * Execute Workflow: runs a published sub-workflow once with this item and waits for it. A failure in
 * the sub-workflow fails this node, so the calling workflow's error workflow handles it.
 * @param {string} name @param {{name:string, inputs:{name:string, type:string}[]}} target the sub-workflow's name and inputs
 * @param {string} src expression for an object holding every input
 */
export function executeWorkflow(name, target, src) {
  const id = workflowPlaceholder(target.name);
  return node(name, 'executeWorkflow', 1.2, {
    source: 'database',
    workflowId: { __rl: true, mode: 'list', value: id, cachedResultName: target.name, cachedResultUrl: `/workflow/${id}` },
    workflowInputs: {
      mappingMode: 'defineBelow', value: Object.fromEntries(target.inputs.map((i) => [i.name, `={{ ${src}.${i.name} }}`])),
      matchingColumns: [], schema: target.inputs.map(inputColumn), attemptToConvertTypes: false, convertFieldsToString: true,
    },
    mode: 'once', options: { waitForSubWorkflow: true },
  });
}

export const schedule = (name, minutes) => node(name, 'scheduleTrigger', 1.2, { rule: { interval: [{ field: 'minutes', minutesInterval: minutes }] } });

export const errorTrigger = (name) => node(name, 'errorTrigger', 1, {});

/**
 * Sticky note. Without `at.position` it is laid out like a node (graph.mjs); with it, it stays put.
 * @param {{position?:[number, number], width?:number}} [at]
 */
export const note = (name, content, height = 200, at = {}) => ({
  name, type: 'n8n-nodes-base.stickyNote', typeVersion: 1, parameters: { content, height, width: at.width ?? 420 },
  ...(at.position ? { position: at.position } : {}),
});
