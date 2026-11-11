import { failure } from './errors.js';
import { sha256Hex } from './sha256.js';

/**
 * Webhook authentication with key rotation. deploy.mjs writes the SHA-256 of each accepted key
 * (BOOKLEAF_WEBHOOK_KEY and, during a rotation, BOOKLEAF_WEBHOOK_KEY_NEXT) into the workflow as a
 * comma-separated list; the key itself never leaves .secrets/. The presented key is hashed and
 * compared with every accepted hash in constant time.
 */
export const KEY_HEADER = 'x-bookleaf-key';
const HASH = /^[0-9a-f]{64}$/;

/** @param {string} a @param {string} b equal-length hex digests @returns {boolean} */
function sameDigest(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** @param {unknown} headers webhook headers (n8n lower-cases the names) @returns {string} */
function presentedKey(headers) {
  const v = headers && typeof headers === 'object' ? headers[KEY_HEADER] : undefined;
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' ? s.trim() : '';
}

/**
 * @param {unknown} headers @param {string} acceptedHashes comma-separated SHA-256 hex digests
 * @returns {boolean} true when the header matches any accepted key (every hash is always compared)
 */
export function isAuthorized(headers, acceptedHashes) {
  const key = presentedKey(headers);
  const hashes = String(acceptedHashes ?? '').split(',').map((h) => h.trim().toLowerCase()).filter((h) => HASH.test(h));
  if (!key || hashes.length === 0) return false;
  const digest = sha256Hex(key);
  return hashes.reduce((ok, h) => sameDigest(digest, h) || ok, false);
}

/**
 * @param {(string|undefined|null)[]} keys current key first, then the optional next key
 * @returns {string} the comma-separated hash list written into the workflow at deploy time
 */
export function keyHashesFor(keys) {
  const real = keys.filter((k) => typeof k === 'string' && k.trim() !== '');
  if (real.length === 0) throw new Error('at least one webhook key is required (BOOKLEAF_WEBHOOK_KEY)');
  return real.map((k) => sha256Hex(k.trim())).join(',');
}

/** @returns {import('./errors.js').Failure} 403 FORBIDDEN */
export const authFailure = () => failure('FORBIDDEN');
