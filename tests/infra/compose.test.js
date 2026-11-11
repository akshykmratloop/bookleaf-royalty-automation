import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** The n8n containers: local (docker/) and production (the repo copy terraform puts on the box). */
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const COMPOSE = { local: read('docker/docker-compose.local.yml'), production: read('infra/terraform/files/docker-compose.yml') };
/** What the workflows used to read through $env; it now lives in the bookleaf_settings table. */
const OLD_WORKFLOW_ENV = [
  'ALLOW_DRILLS', 'EMAIL_PROVIDER', 'CALLBACK_MODE', 'DATA_SOURCE', 'MAX_SENDS_PER_HOUR', 'REFERENCE_DATE_DEFAULT', 'AI_PRIMARY_MODEL',
  'AI_FALLBACK_MODEL', 'AI_EFFORT', 'BUBBLE_APP_BASE', 'BRAND_SUPPORT_EMAIL', 'N8N_INTERNAL_URL', 'DEFAULT_DEMO_INBOX', 'EMAIL_FROM',
];

describe('n8n containers', () => {
  it('leave $env blocked in workflows (n8n blocks it unless N8N_BLOCK_ENV_ACCESS_IN_NODE is "false")', () => {
    for (const [where, yml] of Object.entries(COMPOSE)) expect(yml, where).not.toContain('N8N_BLOCK_ENV_ACCESS_IN_NODE');
  });
  it('the local n8n is given no workflow settings through its environment', () => {
    for (const name of OLD_WORKFLOW_ENV) expect(COMPOSE.local, name).not.toMatch(new RegExp(`\\b${name}\\b`));
  });
});
