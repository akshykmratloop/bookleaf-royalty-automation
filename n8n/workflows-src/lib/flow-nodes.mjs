import { credentialRef } from './credentials.mjs';
import { node, stableUuid } from './nodes.mjs';

/** Email and sub-workflow nodes (n8n 2.45.4 typeVersions); the rest are in nodes.mjs. */

/** What deploy.mjs swaps for a workflow's id on the instance (build.mjs WORKFLOW_SOURCES deploys it first). */
export const workflowPlaceholder = (name) => `__WORKFLOW_${name}__`;

/**
 * Send Email (SMTP), one try: when the server's answer is lost, a second try could send twice. n8n gives
 * every Send Email node a webhookId (for its unused "send and wait" mode) and invents a new one on each
 * save that lacks it; a fixed one keeps the deployed workflow equal to the build.
 * @param {{from:string, to:string, subject:string, text:string, html?:string}} fields expressions; no html = plain text
 */
const emailNode = (name, credential, fields, extra) => node(name, 'emailSend', 2.1, {
  resource: 'email', operation: 'send', fromEmail: `={{ ${fields.from} }}`, toEmail: `={{ ${fields.to} }}`,
  subject: `={{ ${fields.subject} }}`, emailFormat: fields.html ? 'both' : 'text', text: `={{ ${fields.text} }}`,
  ...(fields.html ? { html: `={{ ${fields.html} }}` } : {}), options: { appendAttribution: false },
}, { webhookId: stableUuid(`emailSend/${name}`), credentials: credentialRef(credential), ...extra, retryOnFail: false });

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
 * Execute Workflow: runs a published sub-workflow once with this item and waits for it; its last node's
 * output comes back. A failure in the sub-workflow fails this node, so the calling workflow's error
 * workflow handles it.
 * @param {string} name @param {{name:string, inputs:{name:string, type:string}[]}} target the sub-workflow's name and inputs
 * @param {string|Record<string, string>} src expression for an object holding every input, or one expression per input
 */
export function executeWorkflow(name, target, src) {
  const id = workflowPlaceholder(target.name);
  const valueOf = (input) => (typeof src === 'string' ? `={{ ${src}.${input} }}` : `={{ ${src[input]} }}`);
  return node(name, 'executeWorkflow', 1.2, {
    source: 'database',
    workflowId: { __rl: true, mode: 'list', value: id, cachedResultName: target.name, cachedResultUrl: `/workflow/${id}` },
    workflowInputs: {
      mappingMode: 'defineBelow', value: Object.fromEntries(target.inputs.map((i) => [i.name, valueOf(i.name)])),
      matchingColumns: [], schema: target.inputs.map(inputColumn), attemptToConvertTypes: false, convertFieldsToString: true,
    },
    mode: 'once', options: { waitForSubWorkflow: true },
  });
}
