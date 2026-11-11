import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WORKFLOW_SOURCES } from '../build.mjs';
import { exportable } from '../tools/export.mjs';
import { readEnvFile } from '../tools/env-file.mjs';
import { CREDENTIALS, placeholderId } from '../workflows-src/lib/credentials.mjs';
import { workflowPlaceholder } from '../workflows-src/lib/nodes.mjs';
import { built } from './built.js';

/**
 * n8n/export: the workflows as deployed on the local n8n, ready for `n8n import:workflow --separate`.
 * Credential ids are null (n8n links each credential by name and type on import); workflow ids stay,
 * so the error workflow and the Deliver Email calls still point at the right workflow.
 */
const DIR = new URL('../export/', import.meta.url);
const exported = Object.fromEntries(WORKFLOW_SOURCES.map((n) => [n, JSON.parse(readFileSync(new URL(`${n}.json`, DIR), 'utf8'))]));
const text = JSON.stringify(exported);
const idsByName = Object.fromEntries(Object.values(exported).map((w) => [w.name, w.id]));

/** The built workflow as it must look once deployed and exported. */
function expected(src) {
  let json = JSON.stringify(built[src]);
  for (const key of Object.keys(CREDENTIALS)) json = json.split(`"${placeholderId(key)}"`).join('null');
  for (const [name, id] of Object.entries(idsByName)) json = json.split(workflowPlaceholder(name)).join(id);
  return JSON.parse(json);
}

describe('exportable', () => {
  const live = {
    id: 'wf1', name: 'W', active: true, versionId: 'v', createdAt: 'x', shared: [{ role: 'owner' }], staticData: { a: 1 }, pinData: { N: [{}] },
    nodes: [{ name: 'N', type: 'n8n-nodes-base.postgres', parameters: {}, credentials: { postgres: { id: 'abc123', name: 'BookLeaf Postgres (bookleaf db)' } } }],
    connections: {}, settings: { executionOrder: 'v1' }, tags: [],
  };
  it('keeps the id, name, nodes, connections and settings, nulls every credential id, and drops run data', () => {
    expect(exportable(live)).toEqual({
      id: 'wf1', name: 'W', active: false, nodes: [{ ...live.nodes[0], credentials: { postgres: { id: null, name: 'BookLeaf Postgres (bookleaf db)' } } }],
      connections: {}, settings: { executionOrder: 'v1' }, pinData: {},
    });
    expect(live.nodes[0].credentials.postgres.id).toBe('abc123');
  });
});

describe('committed export (n8n/export)', () => {
  it('holds exactly the six workflows, one file each', () => {
    expect(readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()).toEqual(WORKFLOW_SOURCES.map((n) => `${n}.json`).sort());
  });
  it('matches the committed build (re-export after every deploy of a changed workflow)', () => {
    for (const src of WORKFLOW_SOURCES) {
      const want = expected(src);
      expect(exported[src].name, src).toBe(want.name);
      expect(exported[src].nodes, src).toEqual(want.nodes);
      expect(exported[src].connections, src).toEqual(want.connections);
      expect(exported[src].settings, src).toEqual(want.settings);
    }
  });
  it('cross-workflow references point at workflows in the export', () => {
    const ids = new Set(Object.values(idsByName));
    expect(ids.has(exported['royalty-summary'].settings.errorWorkflow)).toBe(true);
    expect(ids.has(exported['approve-draft'].settings.errorWorkflow)).toBe(true);
    for (const wf of ['royalty-summary', 'approve-draft']) {
      const call = exported[wf].nodes.find((n) => n.name === 'Deliver Email');
      expect(call.parameters.workflowId.value).toBe(idsByName['BookLeaf - Deliver Email']);
    }
  });
});

describe('secret scan of the export', () => {
  it('has no credential id, API key, private key, password field, email address or run data', () => {
    for (const wf of Object.values(exported)) {
      for (const n of wf.nodes.filter((x) => x.credentials)) for (const ref of Object.values(n.credentials)) expect(ref.id, n.name).toBeNull();
      expect(wf.pinData).toEqual({});
      expect(wf).not.toHaveProperty('staticData');
    }
    expect(text).not.toMatch(/sk-ant-api\d\d-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{40,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,}/);
    expect(text).not.toMatch(/"(password|apiKey|api_key|token|secret)"\s*:/i);
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
  });
  it('contains none of the local secret values (checked only where the files exist)', () => {
    const files = ['.secrets/webhook.env', '.secrets/n8n-local.env', '.env'].map((f) => new URL(`../../${f}`, import.meta.url));
    const values = files.filter((f) => existsSync(f)).flatMap((f) => Object.values(readEnvFile(fileURLToPath(f))))
      .filter((v) => typeof v === 'string' && v.length >= 12);
    const leaked = values.filter((v) => text.includes(v));
    expect(leaked.length, 'a value from a local secrets file is in the export').toBe(0);
  });
});
