/**
 * Credentials the workflows use, by logical key. Workflow sources reference them by key; the built
 * JSON carries a placeholder id that deploy.mjs swaps for the real credential id on the instance.
 */
export const CREDENTIALS = Object.freeze({
  postgres: { type: 'postgres', name: 'BookLeaf Postgres (bookleaf db)' },
  anthropic: { type: 'httpHeaderAuth', name: 'BookLeaf Anthropic API (x-api-key)' },
  openai: { type: 'httpBearerAuth', name: 'BookLeaf OpenAI API (bearer)' },
  smtp: { type: 'smtp', name: 'BookLeaf SMTP' },
  smtpDrill: { type: 'smtp', name: 'BookLeaf SMTP (drill: unreachable server)' },
  n8nApi: { type: 'httpHeaderAuth', name: 'BookLeaf n8n API (X-N8N-API-KEY)' },
  /** Checked by the three webhooks (Header Auth on X-BookLeaf-Key); no HTTP Request node may send it. */
  webhookKey: { type: 'httpHeaderAuth', name: 'BookLeaf Webhook Key' },
});

export const placeholderId = (key) => `__CREDENTIAL_${key}__`;

/** @param {keyof typeof CREDENTIALS} key @returns {Record<string, {id:string, name:string}>} node `credentials` value */
export function credentialRef(key) {
  const c = CREDENTIALS[key];
  if (!c) throw new Error(`Unknown credential ${key}`);
  return { [c.type]: { id: placeholderId(key), name: c.name } };
}
