import { ERROR_CODES, MAX_ERROR_LENGTH } from './errors.js';

/**
 * The two ways a job that never finished is ended from outside its own run: the error workflow (an
 * execution failed) and the sweeper (a job ran too long). Both take a job at stage `sending` (Deliver
 * Email saved the email, then the run stopped) as EMAIL_UNCERTAIN: the email may already be out.
 */
const P = '$1::jsonb';
/** @param {string} text @returns {string} a SQL string literal */
const literal = (text) => `'${text.replaceAll("'", "''")}'`;
const UNCERTAIN = "CASE WHEN stage = 'sending' THEN 'EMAIL_UNCERTAIN' ELSE 'INTERNAL' END";
/** The text of `$1->>key` on one line, or `fallback` when empty. */
const oneLine = (key, fallback) => `coalesce(nullif(btrim(regexp_replace(${P}->>'${key}', '\\s+', ' ', 'g')), ''), ${literal(fallback)})`;

/**
 * Fail Job (error handler), with {execution_id, node, message} from the Error Trigger. The job belongs to
 * the execution whose id it carries: the enqueue writes royalty-summary's, Claim Draft approve-draft's,
 * so a duplicate request's run (which owns no job) can never fail the earlier job. Only a job still
 * QUEUED/PROCESSING changes. Always returns exactly one row: the job it failed (or nulls) and who to
 * alert (alert_email; empty = nobody) from which address.
 */
export const FAIL_JOB = `WITH failed AS (
  UPDATE royalty_jobs SET status = 'FAILED', stage = 'failed', stage_at = now(),
    error_code = ${UNCERTAIN},
    error = left(CASE WHEN stage = 'sending' THEN ${literal(ERROR_CODES.EMAIL_UNCERTAIN.message)} ELSE ${literal(ERROR_CODES.INTERNAL.message)} END
      || format(' Node "%s": %s', ${oneLine('node', 'unknown node')}, ${oneLine('message', 'no message')}), ${MAX_ERROR_LENGTH}),
    completed_at = now(), updated_at = now()
  WHERE execution_id = ${P}->>'execution_id' AND status IN ('QUEUED', 'PROCESSING')
  RETURNING job_id::text AS job_id, error_code)
SELECT (SELECT job_id FROM failed LIMIT 1) AS job_id, (SELECT error_code FROM failed LIMIT 1) AS error_code,
  bookleaf_setting('alert_email') #>> '{}' AS alert_to,
  format('%s <%s>', bookleaf_setting('sender_name') #>> '{}', bookleaf_setting('email_from') #>> '{}') AS alert_from`;
