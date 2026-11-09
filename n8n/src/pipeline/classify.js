import { errorBody, failure } from './errors.js';

/** Switch output index after the insert. */
export const INSERT_ROUTES = Object.freeze({ QUEUED: 0, DUPLICATE: 1, RATE_LIMITED: 2 });

/**
 * Turns the insert row into the webhook answer.
 * @param {{job_id:string|null, status:string|null, error_code:string|null, inserted:boolean, recent_sends:number}} row
 * @param {{maxSendsPerHour:number}} config
 * @returns {{route:number, outcome:string, http_status:number, response:Object, job_id:string|null}}
 */
export function classifyInsert(row, config) {
  if (!row || !row.job_id) {
    const f = failure('RATE_LIMITED', `The limit is ${config.maxSendsPerHour} per hour; try again later.`);
    return { route: INSERT_ROUTES.RATE_LIMITED, outcome: 'RATE_LIMITED', http_status: f.http_status, response: errorBody(f), job_id: null };
  }
  if (row.inserted) {
    return {
      route: INSERT_ROUTES.QUEUED, outcome: 'QUEUED', http_status: 202, job_id: row.job_id,
      response: { job_id: row.job_id, status: 'QUEUED', duplicate: false },
    };
  }
  return {
    route: INSERT_ROUTES.DUPLICATE, outcome: 'DUPLICATE', http_status: 200, job_id: row.job_id,
    response: { job_id: row.job_id, status: row.status, duplicate: true, ...(row.error_code ? { error_code: row.error_code } : {}) },
  };
}
