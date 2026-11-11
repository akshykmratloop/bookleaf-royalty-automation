/**
 * Random v4 UUID. `random` returns 16 integers 0..255; by default Web Crypto when the sandbox has
 * it, else Math.random (job ids are identifiers, not secrets).
 * @param {() => number[]} [random] @returns {string}
 */
export function uuidV4(random = defaultRandom) {
  const b = random().slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function defaultRandom() {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') return [...c.getRandomValues(new Uint8Array(16))];
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
