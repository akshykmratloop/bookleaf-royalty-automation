/**
 * Build-time node settings: AI retries and the sweeper's schedule. They shape the workflow graph or
 * n8n node settings, which cannot come from bookleaf_settings at run time; changing one means
 * rebuilding and redeploying the workflows. Run-time values (timeouts, limits, windows) are settings.
 * Send Email is deliberately not here: it never retries (workflows-src/lib/nodes.mjs sendEmail).
 */
export const TUNING = Object.freeze({
  /**
   * Extra tries of an AI request that failed in a way that can pass (429, 5xx, a timeout); a 4xx goes
   * straight to the fallback provider. Each wait doubles from the base, or follows Retry-After, up to the cap.
   */
  aiRetries: 1,
  aiRetryBaseSeconds: 2,
  aiRetryMaxWaitSeconds: 10,
  /**
   * Extra tries of a Postgres read, or of a write guarded by the job's status (repeating it changes
   * nothing more), after a dropped connection; and the wait between tries.
   */
  dbRetries: 2,
  dbRetryWaitMs: 1000,
  /**
   * n8n's executionTimeout for Royalty Summary and Write Draft, in seconds: n8n ends a run that is still
   * going, so it stops paying for AI calls. readSettings checks the AI worst case fits inside it.
   */
  runTimeoutSeconds: 600,
  /** With the database down every run fails: the error handler alerts about it at most this often. */
  dbDownAlertEveryMinutes: 15,
  /** The sweeper's cadence: every minute, so a stuck job fails close to stuck_job_minutes (lead's decision). */
  sweepEveryMinutes: 1,
});
