import { describe, expect, it } from 'vitest';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { credentialData, webhookKey } from '../tools/secrets.mjs';

/** Test-only key; the real one lives in .secrets/webhook.env and is never committed. */
const KEY = 'secrets-test-key-dddddddddddddddddddddddddd';

/** A webhook.env path in a fresh temp folder, written with `text` when given. */
function keyFile(text) {
  const path = join(mkdtempSync(join(tmpdir(), 'bookleaf-secrets-')), 'webhook.env');
  if (text !== undefined) writeFileSync(path, text, { mode: 0o600 });
  return path;
}

/** @returns {string} the message `fn` throws ('' when it does not throw) */
function errorOf(fn) {
  try {
    fn();
    return '';
  } catch (e) {
    return e.message;
  }
}

describe('webhookKey', () => {
  it('generates the key file once (mode 600), then reads the same key', () => {
    const path = keyFile();
    const first = webhookKey(path);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(webhookKey(path)).toBe(first);
    expect(webhookKey(keyFile(`BOOKLEAF_WEBHOOK_KEY=${KEY}\n`))).toBe(KEY);
  });
  it('refuses a second key: Header Auth checks exactly one (rotate = new key, deploy, update Bubble)', () => {
    const path = keyFile(`BOOKLEAF_WEBHOOK_KEY=${KEY}\nBOOKLEAF_WEBHOOK_KEY_NEXT=${KEY}x\n`);
    expect(() => webhookKey(path)).toThrow(/BOOKLEAF_WEBHOOK_KEY_NEXT/);
  });
  it('refuses a weak or spaced key, naming the variable, never the value', () => {
    for (const bad of ['tiny-key', `${KEY.slice(0, 20)} ${KEY.slice(20)}`]) {
      const message = errorOf(() => webhookKey(keyFile(`BOOKLEAF_WEBHOOK_KEY='${bad}'\n`)));
      expect(message).toMatch(/BOOKLEAF_WEBHOOK_KEY must be 32 to 256 printable characters/);
      expect(message).not.toContain(bad);
    }
  });
});

describe('credentialData', () => {
  it('the webhook key credential sends X-BookLeaf-Key and no HTTP Request node may use it', () => {
    const data = credentialData({ db: {}, smtp: {}, ai: {}, webhookKey: KEY });
    expect(data.webhookKey).toEqual({ name: 'X-BookLeaf-Key', value: KEY, allowedHttpRequestDomains: 'none' });
  });
  it('carries no n8n API key: the error handler no longer calls the n8n API', () => {
    expect(Object.keys(credentialData({ db: {}, smtp: {}, ai: {}, webhookKey: KEY }))).toEqual(['postgres', 'anthropic', 'openai', 'smtp', 'smtpDrill', 'webhookKey']);
  });
});
