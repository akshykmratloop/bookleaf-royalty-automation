/**
 * Deterministic JSON: object keys sorted at every level, so the same data always gives the same
 * string (and the same fingerprint), whatever order Bubble sends the fields in.
 * @param {unknown} v @returns {string}
 */
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}
