/**
 * Error-code taxonomy shared by every workflow branch. Bubble shows `code` in the Notification Log;
 * `retryable` tells the admin whether pressing "Send again" can help.
 */
export const ERROR_CODES = Object.freeze({
  VALIDATION: { http: 400, retryable: false, message: 'The request is missing fields or has invalid values.' },
  FORBIDDEN: { http: 403, retryable: false, message: 'The X-BookLeaf-Key header is missing or wrong.' },
  INTEGRITY: { http: 422, retryable: false, message: 'The royalty figures do not add up, so no email was written.' },
  NO_RECIPIENT: { http: 422, retryable: false, message: 'No demo inbox is configured, so the email has nowhere safe to go.' },
  RATE_LIMITED: { http: 429, retryable: true, message: 'Too many emails were sent in the last hour.' },
  DATA_UNAVAILABLE: { http: 502, retryable: true, message: 'The author data could not be loaded.' },
  AI_UNAVAILABLE: { http: 502, retryable: true, message: 'Neither AI provider returned a usable draft.' },
  AI_FACT_CHECK_FAILED: { http: 422, retryable: true, message: 'The AI draft quoted figures that do not match the data, twice.' },
  EMAIL_FAILED: { http: 502, retryable: true, message: 'The email server did not accept the email.' },
  TIMEOUT: { http: 504, retryable: true, message: 'The job did not finish within 10 minutes.' },
  INTERNAL: { http: 500, retryable: true, message: 'An unexpected error stopped the workflow.' },
});

export const MAX_ERROR_LENGTH = 1000;

/**
 * @typedef {keyof typeof ERROR_CODES} ErrorCode
 * @typedef {{ok:false, code:ErrorCode, message:string, http_status:number, retryable:boolean, fields?:Object[]}} Failure
 */

/**
 * @param {ErrorCode} code @param {string} [detail] specific reason, appended to the standard message
 * @param {Object[]} [fields] validation errors ({path, code, message})
 * @returns {Failure}
 */
export function failure(code, detail, fields) {
  const def = ERROR_CODES[code];
  if (!def) throw new TypeError(`Unknown error code ${code}`);
  const message = (detail ? `${def.message} ${detail}` : def.message).slice(0, MAX_ERROR_LENGTH);
  const out = { ok: false, code, message, http_status: def.http, retryable: def.retryable };
  return fields ? { ...out, fields } : out;
}

/** @param {Failure} f @returns {{error:{code:string, message:string, retryable:boolean, fields?:Object[]}}} webhook response body */
export function errorBody(f) {
  const error = { code: f.code, message: f.message, retryable: f.retryable };
  return { error: f.fields ? { ...error, fields: f.fields } : error };
}
