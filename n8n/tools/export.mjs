#!/usr/bin/env node
/**
 * Writes n8n/export/<workflow>.json from the workflows deployed on an n8n instance, ready for
 *   n8n import:workflow --separate --input=n8n/export
 * Credential ids are set to null: on import n8n links each node's credential by name and type to one
 * that exists there. Workflow ids are kept, so the error workflow and the Deliver Email calls still
 * point at the right workflow. Run it against the LOCAL n8n after a deploy:
 *   node n8n/tools/export.mjs --env .secrets/n8n-local.env
 * Nothing secret is read or printed: workflows hold no credential data.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildWorkflow, WORKFLOW_SOURCES } from '../build.mjs';
import { readEnvFile, requireKeys } from './env-file.mjs';
import { n8nApi } from './n8n-api.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXPORT_DIR = join(ROOT, 'n8n', 'export');

/** A node with every credential id set to null (names and types stay). */
const withoutCredentialIds = (node) => (node.credentials
  ? { ...node, credentials: Object.fromEntries(Object.entries(node.credentials).map(([type, c]) => [type, { id: null, name: c.name }])) }
  : node);

/**
 * The importable part of a workflow read from the n8n API: no version, owner, run or pinned data;
 * imported inactive.
 * @param {{id:string, name:string, nodes:Object[], connections:Object, settings:Object}} wf
 */
export function exportable(wf) {
  return {
    id: wf.id, name: wf.name, active: false, nodes: wf.nodes.map(withoutCredentialIds),
    connections: wf.connections, settings: wf.settings, pinData: {},
  };
}

/** @returns {Promise<Record<string, string>>} workflow name → the source file name it is built from */
async function sourceNames() {
  const entries = await Promise.all(WORKFLOW_SOURCES.map(async (src) => [(await buildWorkflow(src)).name, src]));
  return Object.fromEntries(entries);
}

async function main() {
  const i = process.argv.indexOf('--env');
  const envPath = resolve(ROOT, i > -1 && process.argv[i + 1] ? process.argv[i + 1] : '.secrets/n8n-local.env');
  const { N8N_BASE_URL: baseUrl, N8N_API_KEY: apiKey } = requireKeys(readEnvFile(envPath), ['N8N_BASE_URL', 'N8N_API_KEY'], envPath);
  const api = n8nApi({ baseUrl, apiKey });
  const sources = await sourceNames();
  const live = (await api.listAll('/workflows')).filter((w) => !w.isArchived && w.name in sources);
  const missing = Object.keys(sources).filter((name) => !live.some((w) => w.name === name));
  if (missing.length) throw new Error(`not deployed on ${new URL(baseUrl).host}: ${missing.join(', ')}`);
  if (live.length > Object.keys(sources).length) throw new Error('two workflows share a BookLeaf name: archive the stale one first');
  mkdirSync(EXPORT_DIR, { recursive: true });
  for (const summary of live) {
    const wf = exportable(await api.call('GET', `/workflows/${summary.id}`));
    writeFileSync(join(EXPORT_DIR, `${sources[wf.name]}.json`), `${JSON.stringify(wf, null, 2)}\n`);
    console.log(`exported ${wf.name} (${wf.id})`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`export failed: ${e.message}`);
    process.exit(1);
  });
}
