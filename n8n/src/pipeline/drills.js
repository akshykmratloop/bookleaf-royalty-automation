import { failure } from './errors.js';

/**
 * Failure drills let an admin prove each failure path on demand. They are honoured only when the
 * server sets ALLOW_DRILLS=true; a drill request on a server without drills is rejected (never
 * ignored, which could send a real email to someone expecting a drill).
 * @param {{ai_down:boolean, email_down:boolean, data_down:boolean}} requested
 * @param {{allowDrills:boolean}} config
 * @returns {{ok:true, drills:{ai_down:boolean, email_down:boolean, data_down:boolean}}|import('./errors.js').Failure}
 */
export function effectiveDrills(requested, config) {
  const any = Object.values(requested).some(Boolean);
  if (any && !config.allowDrills) {
    return failure('VALIDATION', 'Drills are turned off on this server.', [
      { path: 'drills', code: 'DISABLED', message: 'drills are turned off on this server (ALLOW_DRILLS)' },
    ]);
  }
  return { ok: true, drills: { ...requested } };
}
