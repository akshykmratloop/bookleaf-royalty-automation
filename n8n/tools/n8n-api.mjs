/**
 * Minimal n8n public-API client (X-N8N-API-KEY). Errors carry the HTTP status and n8n's message,
 * never the request headers or credential data.
 */
export class N8nApiError extends Error {
  constructor(method, path, status, message) {
    super(`${method} ${path} -> HTTP ${status}: ${message}`);
    this.status = status;
  }
}

/** @param {{baseUrl:string, apiKey:string}} opts */
export function n8nApi({ baseUrl, apiKey }) {
  const root = `${baseUrl.replace(/\/+$/, '')}/api/v1`;
  async function call(method, path, body) {
    const res = await fetch(`${root}${path}`, {
      method,
      headers: { 'X-N8N-API-KEY': apiKey, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? safeJson(text) : {};
    if (!res.ok) throw new N8nApiError(method, path, res.status, json?.message ?? text.slice(0, 200));
    return json;
  }
  async function listAll(path) {
    const out = [];
    let cursor = null;
    do {
      const sep = path.includes('?') ? '&' : '?';
      const page = await call('GET', `${path}${sep}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      out.push(...(page.data ?? []));
      cursor = page.nextCursor ?? null;
    } while (cursor);
    return out;
  }
  return { call, listAll };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 200) };
  }
}
