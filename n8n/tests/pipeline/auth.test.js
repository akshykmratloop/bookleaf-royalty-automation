import { describe, expect, it } from 'vitest';
import { authFailure, isAuthorized, KEY_HEADER, keyHashesFor } from '../../src/pipeline/auth.js';
import { sha256Hex } from '../../src/pipeline/sha256.js';

/** Test-only keys; real keys live in .secrets/webhook.env and are never printed. */
const CURRENT = 'test-current-key-aaaaaaaaaaaaaaaaaaaaaaaa';
const NEXT = 'test-next-key-bbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const both = [sha256Hex(CURRENT), sha256Hex(NEXT)].join(',');
const headers = (key) => ({ [KEY_HEADER]: key });

describe('webhook key check (current + next key, for rotation)', () => {
  it('accepts the current key and the next key', () => {
    expect(isAuthorized(headers(CURRENT), both)).toBe(true);
    expect(isAuthorized(headers(NEXT), both)).toBe(true);
    expect(isAuthorized(headers(CURRENT), sha256Hex(CURRENT))).toBe(true);
  });
  it('rejects a wrong, missing or empty key', () => {
    expect(isAuthorized(headers('wrong'), both)).toBe(false);
    expect(isAuthorized({}, both)).toBe(false);
    expect(isAuthorized(headers(''), both)).toBe(false);
    expect(isAuthorized(undefined, both)).toBe(false);
    expect(isAuthorized(headers(NEXT), sha256Hex(CURRENT))).toBe(false);
  });
  it('fails closed when no key hash was deployed (placeholder left in place)', () => {
    expect(isAuthorized(headers(CURRENT), '__WEBHOOK_KEY_HASHES__')).toBe(false);
    expect(isAuthorized(headers(CURRENT), '')).toBe(false);
  });
  it('keyHashesFor hashes the configured keys, skipping an empty next key', () => {
    expect(keyHashesFor([CURRENT, '', undefined])).toBe(sha256Hex(CURRENT));
    expect(keyHashesFor([CURRENT, NEXT])).toBe(both);
    expect(() => keyHashesFor([])).toThrow(/at least one webhook key/);
  });
  it('the failure is a 403 that names no key', () => {
    expect(authFailure()).toMatchObject({ ok: false, code: 'FORBIDDEN', http_status: 403, retryable: false });
    expect(JSON.stringify(authFailure())).not.toContain(CURRENT);
  });
});
