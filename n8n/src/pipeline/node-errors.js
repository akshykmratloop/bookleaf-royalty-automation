const SECRET_LIKE = /\b(sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,})/g;
const MAX = 300;

/** @param {string} s @returns {unknown} parsed JSON, or undefined when s is not JSON (a normal case, not an error) */
function parseJsonOrUndefined(s) {
  if (typeof s !== 'string' || !/^\s*["{[]/.test(s)) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** n8n HTTP errors look like `404 - "{\"error\":{\"message\":...}}"`; keep the status and the API's own message. */
function readable(message) {
  const m = /^(\d{3}) - ([\s\S]*)$/.exec(message);
  if (!m) return message;
  let body = parseJsonOrUndefined(m[2]);
  if (typeof body === 'string') body = parseJsonOrUndefined(body);
  const inner = body?.error?.message ?? body?.message;
  return typeof inner === 'string' ? `${m[1]} ${inner}` : message;
}

/**
 * One-line, secret-free summary of an n8n node error item ({error:{message, description, httpCode}}).
 * @param {unknown} item json of an error-output item @param {string} label e.g. "anthropic"
 * @returns {string}
 */
export function nodeErrorSummary(item, label) {
  const e = item && typeof item === 'object' ? item.error ?? item : {};
  const message = typeof e.message === 'string' ? readable(e.message) : '';
  const code = e.httpCode && !message.startsWith(String(e.httpCode)) ? String(e.httpCode) : '';
  const parts = [code, message, e.description].filter((p) => typeof p === 'string' && p.trim());
  const text = parts.join(' - ').replace(SECRET_LIKE, '[redacted]').replace(/\s+/g, ' ').trim();
  return `${label}: ${text || 'unknown error'}`.slice(0, MAX);
}
