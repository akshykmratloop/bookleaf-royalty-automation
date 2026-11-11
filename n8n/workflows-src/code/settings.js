/** Entry point of the "Check Settings" Code node (Royalty Summary and Approve Draft). */
import { errorBody } from '../../src/pipeline/errors.js';
import { readSettings } from '../../src/pipeline/settings.js';

/**
 * The Load Settings row, checked on its own before the body is read. ok: `settings` are safe to use;
 * not ok: the 500 INTERNAL answer naming each bad setting (never its value).
 */
export function checkSettings({ settings }) {
  const read = readSettings(settings);
  if (!read.ok) return [{ json: { ok: false, http_status: read.http_status, response: errorBody(read) } }];
  return [{ json: { ok: true, settings: read.settings } }];
}
