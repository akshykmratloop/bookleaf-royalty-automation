import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { sha256Hex } from '../../src/pipeline/sha256.js';
import { canonicalJson } from '../../src/pipeline/canonical.js';

const ref = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('sha256Hex', () => {
  it.each(['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), '₹3,570 — Kavita 🌿 देशमुख'])(
    'matches node:crypto for %j', (s) => expect(sha256Hex(s)).toBe(ref(s)),
  );
});

describe('canonicalJson', () => {
  it('sorts keys at every level and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[2,{"y":2,"z":1}]},"b":1}');
  });
  it('is order independent', () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });
  it('renders null for missing values', () => expect(canonicalJson(undefined)).toBe('null'));
});
