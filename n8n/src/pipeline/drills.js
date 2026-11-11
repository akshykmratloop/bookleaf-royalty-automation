import { failure } from './errors.js';

/**
 * Failure drills let an admin prove each failure path on demand. They are honoured only when the
 * allow_drills setting is true; a drill request on a server without drills is rejected (never
 * ignored, which could send a real email to someone expecting a drill).
 * @param {{ai_down:boolean, email_down:boolean, data_down:boolean}} requested
 * @param {{allow_drills:boolean}} settings
 * @returns {{ok:true, drills:{ai_down:boolean, email_down:boolean, data_down:boolean}}|import('./errors.js').Failure}
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
