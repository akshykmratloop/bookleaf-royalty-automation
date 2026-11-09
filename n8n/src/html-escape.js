const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** @param {unknown} value @returns {string} text safe for HTML body and attribute contexts */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => MAP[c]);
}

/** @param {unknown} value @returns {string} escaped, blank lines become paragraph-internal breaks */
export const escapeMultiline = (value) => escapeHtml(value).replace(/\r?\n/g, '<br>');
