import { TUNING } from './tuning.js';

/**
 * @typedef {{alert_to?:string, alert_from?:string, db_alert_at?:number}} AlertCache the error handler's
 *   workflow static data ($getWorkflowStaticData('global')): n8n saves it after each run
 * @typedef {{job_id:string|null, error_code:string|null, alert_to:string, alert_from:string, db_error:string|null}} AlertItem
 */

/**
 * @param {unknown} item @returns {string|null} the error message of a failed node's error-output item
 *   (n8n puts it beside the error object, or inside it), or null for a result row
 */
function errorOf(item) {
  if (!item || typeof item !== 'object' || item.error === undefined) return null;
  const inner = item.error && typeof item.error === 'object' ? item.error.message : item.error;
  return [item.message, inner].find((m) => typeof m === 'string' && m.trim()) || 'unknown database error';
}

/**
 * Who to alert. When Fail Job answered, its row (alert_email from the settings) is used and remembered;
 * when the database could not be reached, the last remembered address is used, at most once per
 * TUNING.dbDownAlertEveryMinutes (a database outage fails every run, the sweeper's every minute).
 * `cache` is n8n's static data object and must be changed in place for n8n to save it.
 * @param {{row:Object, cache:AlertCache, now:number}} input @returns {AlertItem}
 */
export function alertAddress({ row, cache, now }) {
  const dbError = errorOf(row);
  if (dbError === null) {
    cache.alert_to = row.alert_to;
    cache.alert_from = row.alert_from;
    return { ...row, db_error: null };
  }
  const quiet = typeof cache.db_alert_at === 'number' && now - cache.db_alert_at < TUNING.dbDownAlertEveryMinutes * 60_000;
  const to = quiet || !cache.alert_to ? '' : cache.alert_to;
  if (to) cache.db_alert_at = now;
  return { job_id: null, error_code: null, alert_to: to, alert_from: cache.alert_from || '', db_error: dbError };
}
