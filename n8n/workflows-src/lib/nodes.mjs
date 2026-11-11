import { credentialRef } from './credentials.mjs';
import { TUNING } from './tuning.mjs';

/**
 * Small constructors for the n8n nodes used by the BookLeaf workflows (n8n 2.x node types and
 * typeVersions, checked against n8nio/n8n:2.45.4). Code nodes carry `entry`/`body`; build.mjs turns
 * them into a self-contained `jsCode`.
 */
const node = (name, type, typeVersion, parameters, extra = {}) => ({ name, type: `n8n-nodes-base.${type}`, typeVersion, parameters, ...extra });

/** @param {string} name @param {string} entry export of workflows-src/code/entries.js @param {string} body JS run in the node */
export const code = (name, entry, body) => node(name, 'code', 2, { mode: 'runOnceForAllItems', language: 'javaScript' }, { entry, body });

/** Switch in expression mode: `output` evaluates to the output index. */
export const route = (name, outputs, expression) =>
  node(name, 'switch', 3.2, { mode: 'expression', numberOutputs: outputs, output: `={{ ${expression} }}` });

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
 * Send Email (SMTP) with both HTML and text, errors to the second output. The From line comes from the
 * settings (sender_name <email_from>).
 * @param {string} name @param {string} credential @param {string} [src] expression for the {from,to,subject,html,text} object
 */
export const sendEmail = (name, credential, src = '$json.email') => node(name, 'emailSend', 2.1, {
  resource: 'email', operation: 'send', fromEmail: `={{ ${src}.from }}`, toEmail: `={{ ${src}.to }}`,
  subject: `={{ ${src}.subject }}`, emailFormat: 'both', text: `={{ ${src}.text }}`, html: `={{ ${src}.html }}`,
  options: { appendAttribution: false },
}, {
  credentials: credentialRef(credential), onError: 'continueErrorOutput',
  retryOnFail: TUNING.emailTries > 1, maxTries: TUNING.emailTries, waitBetweenTries: TUNING.emailRetryWaitMs,
});

export const schedule = (name, minutes) => node(name, 'scheduleTrigger', 1.2, { rule: { interval: [{ field: 'minutes', minutesInterval: minutes }] } });

export const errorTrigger = (name) => node(name, 'errorTrigger', 1, {});

export const note = (name, content, height = 200) => ({
  name, type: 'n8n-nodes-base.stickyNote', typeVersion: 1, parameters: { content, height, width: 420 },
});
