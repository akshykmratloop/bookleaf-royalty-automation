import { createHash } from 'node:crypto';
import { errorBody, failure } from '../../src/pipeline/errors.js';
import { TUNING } from '../../src/pipeline/tuning.js';
import { credentialRef } from './credentials.mjs';

/**
 * Small constructors for the n8n nodes used by the BookLeaf workflows (n8n 2.x node types and
 * typeVersions, checked against n8nio/n8n:2.45.4). Code nodes carry `entry`/`body`; build.mjs turns
 * them into a self-contained `jsCode`. Email and sub-workflow nodes: flow-nodes.mjs.
 */
export const node = (name, type, typeVersion, parameters, extra = {}) => ({ name, type: `n8n-nodes-base.${type}`, typeVersion, parameters, ...extra });

/** A UUID-shaped id that is the same on every build (n8n wants ids; a reproducible build wants no randomness). */
export function stableUuid(text) {
  const h = createHash('sha256').update(text, 'utf8').digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Shows `text` under the node on the canvas (n8n "Display Note in Flow"), for anything a reader would ask
 * about. The canvas shows one line of about 30 characters, so keep it short.
 */
export const withNote = (n, text) => ({ ...n, notes: text, notesInFlow: true });

/** @param {string} name @param {string} entry export of workflows-src/code/entries.js @param {string} body JS run in the node */
export const code = (name, entry, body) => node(name, 'code', 2, { mode: 'runOnceForAllItems', language: 'javaScript' }, { entry, body });

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
 * Switch 3.2 in Rules mode: one named output per rule, in order (the first rule that matches wins), and a
 * named fallback output last for anything no rule matches.
 * @param {string} name @param {{output:string, conditions:Object}[]} rules @param {string} fallback
 */
const switchNode = (name, rules, fallback) => node(name, 'switch', 3.2, {
  mode: 'rules',
  rules: { values: rules.map((r) => ({ conditions: r.conditions, renameOutput: true, outputKey: r.output })) },
  options: { fallbackOutput: 'extra', renameFallbackOutput: fallback },
});

/**
 * A Switch on one value: each case's output is taken when `left` equals its value.
 * @param {string} name @param {string} left expression tested @param {{output:string, equals:string}[]} cases @param {string} fallback
 */
export const switchRules = (name, left, cases, fallback) => switchNode(name, cases.map((c) => ({
  output: c.output, conditions: filter(`${name}/${c.output}`, left, { type: 'string', operation: 'equals' }, c.equals),
})), fallback);

/**
 * A Switch on conditions: each case's output is taken when its `when` expression is true.
 * @param {string} name @param {{output:string, when:string}[]} cases @param {string} fallback
 */
export const switchWhen = (name, cases, fallback) => switchNode(name, cases.map((c) => ({
  output: c.output, conditions: filter(`${name}/${c.output}`, c.when, IS_TRUE),
})), fallback);

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

/**
 * Postgres query with ONE JSON parameter ($1::jsonb).
 * @param {{alwaysOutputData?:boolean, errorOutput?:boolean, retry?:boolean}} [o] errorOutput: a failure goes to the
 *   second output; retry: only for a read or a status-guarded write, which is safe to run twice (TUNING.dbRetries)
 */
export const pg = (name, query, paramExpr, o = {}) => node(name, 'postgres', 2.6, {
  operation: 'executeQuery', query, options: paramExpr ? { queryReplacement: `={{ ${paramExpr} }}` } : {},
}, {
  credentials: credentialRef('postgres'),
  ...(o.alwaysOutputData ? { alwaysOutputData: true } : {}),
  ...(o.errorOutput ? { onError: 'continueErrorOutput' } : {}),
  ...(o.retry ? { retryOnFail: true, maxTries: TUNING.dbRetries + 1, waitBetweenTries: TUNING.dbRetryWaitMs } : {}),
});

/**
 * Respond to Webhook with a fixed status and JSON body (no expression: a JSON body ends in "}}", which
 * would close an n8n expression early).
 */
export const respondFixed = (name, status, body) => node(name, 'respondToWebhook', 1.1, {
  respondWith: 'json', responseBody: JSON.stringify(body), options: { responseCode: status },
});

/** The answer when the database failed before the webhook answered: 503 DB_UNAVAILABLE. */
export const respondDatabaseDown = (name) => respondFixed(name, 503, errorBody(failure('DB_UNAVAILABLE')));

/**
 * HTTP Request with a JSON body and a credential that never retries on its own. Every answer, whatever
 * its status, comes out as {statusCode, headers, body} on the first output, so the workflow decides what
 * to retry; a request that gets no answer (a timeout, a refused connection) goes to the error output.
 * @param {{method:string, url:string, credential:string, authType:string, body:string, headers?:Object, timeout:string}} o
 *   `timeout`: an expression giving milliseconds
 */
export function http(name, o) {
  const parameters = {
    method: o.method, url: o.url, authentication: 'genericCredentialType', genericAuthType: o.authType,
    sendHeaders: Boolean(o.headers), headerParameters: { parameters: Object.entries(o.headers ?? {}).map(([k, v]) => ({ name: k, value: v })) },
    sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: `={{ ${o.body} }}`,
    options: { timeout: o.timeout, response: { response: { fullResponse: true, neverError: true } } },
  };
  return node(name, 'httpRequest', 4.2, parameters, { credentials: credentialRef(o.credential), onError: 'continueErrorOutput' });
}

/**
 * Wait 1.1 for `seconds` (an expression). Under 65 s n8n sleeps inside the running execution (no
 * resume webhook is used); the fixed webhookId keeps the deployed node equal to the build.
 */
export const wait = (name, seconds) => node(name, 'wait', 1.1, { resume: 'timeInterval', amount: `={{ ${seconds} }}`, unit: 'seconds' },
  { webhookId: stableUuid(`wait/${name}`) });

/** Stop and Error: fails the run on purpose with `message`, so the workflow's error workflow takes over. */
export const stopAndError = (name, message) => node(name, 'stopAndError', 1, { errorType: 'errorMessage', errorMessage: message });

export const schedule = (name, minutes) => node(name, 'scheduleTrigger', 1.2, { rule: { interval: [{ field: 'minutes', minutesInterval: minutes }] } });

export const errorTrigger = (name) => node(name, 'errorTrigger', 1, {});
