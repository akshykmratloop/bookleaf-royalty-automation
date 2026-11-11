/** Queries of the approve-draft workflow. One JSON parameter ($1::jsonb), as in sql.js. */
const P = '$1::jsonb';
const BY_ID = `job_id = (${P}->>'job_id')::uuid`;
/** A draft can still be sent while it is younger than the draft_ttl_hours setting. */
const FRESH = "drafted_at > now() - make_interval(hours => bookleaf_setting('draft_ttl_hours')::int)";

/** Everything needed to re-check and re-render an edited draft, and whether it is still `fresh`. */
export const SELECT_DRAFT = `SELECT job_id::text AS job_id, status, stage, delivery, tone, length, sign_off, recipient, author_code,
  sections, facts, titles, drills, drafted_at, (${FRESH}) AS fresh
FROM royalty_jobs WHERE ${BY_ID}`;

/** Atomic claim: of two concurrent sends exactly one gets the row back, so one email goes out. */
export const CLAIM_DRAFT = `UPDATE royalty_jobs SET status = 'PROCESSING', stage = 'sending', stage_at = now(), updated_at = now()
WHERE ${BY_ID} AND status = 'DRAFTED' AND ${FRESH}
RETURNING job_id::text AS job_id, status`;

export const DISCARD_DRAFT = `UPDATE royalty_jobs
SET status = 'DISCARDED', stage = 'discarded', stage_at = now(), completed_at = now(), updated_at = now()
WHERE ${BY_ID} AND status = 'DRAFTED'
RETURNING job_id::text AS job_id, status`;
