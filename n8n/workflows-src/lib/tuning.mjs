/**
 * Build-time node settings: retries and the sweeper's schedule. They are n8n node settings, which
 * cannot be expressions, so they cannot come from bookleaf_settings at run time; changing one means
 * rebuilding and redeploying the workflows. Run-time values (timeouts, limits, windows) are settings.
 */
export const TUNING = Object.freeze({
  /** Extra tries of each AI request after the first, and the wait between them. */
  aiRetries: 2,
  aiRetryWaitMs: 2000,
  /** Send Email: tries in all, and the wait between them. */
  emailTries: 2,
  emailRetryWaitMs: 2000,
  /** The sweeper's cadence: every minute, so a stuck job fails close to stuck_job_minutes (lead's decision). */
  sweepEveryMinutes: 1,
});
