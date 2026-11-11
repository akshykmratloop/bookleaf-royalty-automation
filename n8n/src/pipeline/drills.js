import { failure } from './errors.js';

/**
 * The crash drill: Build Context throws this, so the execution fails like an unexpected bug would and
 * the error workflow (Fail Job by execution id, then the alert) has to clean up.
 */
export class CrashDrillError extends Error {
  constructor() {
    super('Failure drill: the workflow crashed on purpose.');
    this.name = 'CrashDrillError';
  }
}

/**
 * Failure drills let an admin prove each failure path on demand. They are honoured only when the
 * allow_drills setting is true; a drill request on a server without drills is rejected (never
 * ignored, which could send a real email to someone expecting a drill).
 * @param {Record<string, boolean>} requested one flag per drill (request.js DRILLS)
 * @param {{allow_drills:boolean}} settings
 * @returns {{ok:true, drills:Record<string, boolean>}|import('./errors.js').Failure}
 */
export function effectiveDrills(requested, settings) {
  const any = Object.values(requested).some(Boolean);
  if (any && !settings.allow_drills) {
    return failure('VALIDATION', 'Drills are turned off on this server.', [
      { path: 'drills', code: 'DISABLED', message: 'drills are turned off on this server (setting allow_drills)' },
    ]);
  }
  return { ok: true, drills: { ...requested } };
}
