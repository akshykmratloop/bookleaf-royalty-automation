import { describe, expect, it } from 'vitest';
import { ERROR_CODES, MAX_ERROR_LENGTH } from '../../src/pipeline/errors.js';
import { MAX_SUMMARY_LENGTH } from '../../src/pipeline/node-errors.js';
import { CLAIM_DRAFT, DISCARD_DRAFT, SELECT_DRAFT } from '../../src/pipeline/sql-approve.js';
import {
  INSERT_JOB, LOAD_SETTINGS, MARK_EMAIL_FAILED, MARK_PROCESSING, MARK_SENT, SELECT_JOBS, SET_STAGE, SWEEP_STUCK, UPDATE_JOB,
} from '../../src/pipeline/sql.js';
import { shapeJobs } from '../../src/pipeline/status.js';

/** The SQL is exercised live by the contract suite; these pin the guards that keep it safe. */
describe('job ledger SQL guards', () => {
  it('the sweeper only fails QUEUED/PROCESSING jobs, never drafts', () => {
    expect(SWEEP_STUCK).toMatch(/WHERE status IN \('QUEUED', 'PROCESSING'\)/);
    expect(SWEEP_STUCK).not.toMatch(/DRAFTED|DISCARDED/);
    expect(SWEEP_STUCK).toMatch(/stage = 'failed'/);
  });
  it('the sweeper waits stuck_job_minutes and says so in the error', () => {
    expect(SWEEP_STUCK).toContain("bookleaf_setting('stuck_job_minutes')::int");
    expect(SWEEP_STUCK).toContain('< now() - make_interval(mins => s.minutes)');
    expect(SWEEP_STUCK).toContain("format('The job did not finish within %s minutes");
    expect(SWEEP_STUCK).not.toMatch(/interval '\d+ minutes'/);
  });
  it('Load Settings reads every setting as one JSON object', () => {
    expect(LOAD_SETTINGS).toBe('SELECT jsonb_object_agg(key, value) AS settings FROM bookleaf_settings');
  });
  it('UPDATE_JOB still only touches unfinished jobs and records the stage', () => {
    expect(UPDATE_JOB).toMatch(/WHERE j\.job_id = p\.job_id AND j\.status IN \('QUEUED', 'PROCESSING'\)/);
    for (const col of ['stage', 'sections', 'facts', 'titles', 'edit_text', 'issues', 'drafted_at']) expect(UPDATE_JOB).toContain(col);
  });
  it('stage updates never move a finished job', () => {
    expect(SET_STAGE).toMatch(/status IN \('QUEUED', 'PROCESSING'\)/);
    expect(MARK_PROCESSING).toContain("stage = 'reading_data'");
    expect(INSERT_JOB).toContain("'queued'");
  });
  it('no push callback: new jobs are NOT_NEEDED and nothing updates callback_status afterwards', () => {
    expect(INSERT_JOB).toContain("'NOT_NEEDED'");
    expect(INSERT_JOB).not.toContain("v->>'callback_status'");
    expect(UPDATE_JOB).not.toContain('callback_status');
  });
  it('a draft is claimed atomically: only DRAFTED, only within draft_ttl_hours', () => {
    const fresh = "drafted_at > now() - make_interval(hours => bookleaf_setting('draft_ttl_hours')::int)";
    expect(CLAIM_DRAFT).toMatch(/SET status = 'PROCESSING', stage = 'sending'/);
    expect(CLAIM_DRAFT).toContain(`AND status = 'DRAFTED' AND ${fresh}`);
    expect(SELECT_DRAFT).toContain(`(${fresh}) AS fresh`);
    expect(`${CLAIM_DRAFT}${SELECT_DRAFT}`).not.toMatch(/interval '\d+ hours'/);
    expect(DISCARD_DRAFT).toMatch(/SET status = 'DISCARDED', stage = 'discarded'/);
    expect(DISCARD_DRAFT).toMatch(/AND status = 'DRAFTED'/);
    expect(SELECT_DRAFT).toMatch(/AS fresh/);
  });
  it('Deliver Email records the end only for a job still running; the email itself was saved by Mark Sending', () => {
    for (const sql of [MARK_SENT, MARK_EMAIL_FAILED]) {
      expect(sql).toMatch(/WHERE job_id = \(\$1::jsonb->>'job_id'\)::uuid AND status IN \('QUEUED', 'PROCESSING'\)/);
      expect(sql).toContain('completed_at = now()');
      expect(sql).not.toMatch(/\bsubject\b|\bhtml\b|text_body|callback_status/);
    }
    expect(MARK_SENT).toMatch(/SET status = 'SENT', stage = 'sent', stage_at = now\(\), sent_to = \$1::jsonb->>'sent_to'/);
    expect(MARK_EMAIL_FAILED).toMatch(/SET status = 'FAILED', stage = 'failed', stage_at = now\(\), error_code = 'EMAIL_FAILED'/);
    expect(MARK_EMAIL_FAILED).not.toContain('sent_to');
  });
  it('an EMAIL_FAILED error reads like the other failures: the standard message, then "smtp: " and the server\'s own', () => {
    expect(MARK_EMAIL_FAILED).toContain(`'${ERROR_CODES.EMAIL_FAILED.message} ' || left('smtp: ' ||`);
    expect(MARK_EMAIL_FAILED).toContain(`, ${MAX_SUMMARY_LENGTH})`);
    expect(MARK_EMAIL_FAILED).toContain("'unknown error'");
    // So the whole text always fits the error column's cap without cutting the server's message.
    expect(ERROR_CODES.EMAIL_FAILED.message.length + 1 + MAX_SUMMARY_LENGTH).toBeLessThanOrEqual(MAX_ERROR_LENGTH);
  });
  it('job status returns the new fields', () => {
    for (const col of ['stage', 'delivery', 'tone', 'length', 'edit_text', 'issues', 'drafted_at']) expect(SELECT_JOBS).toContain(col);
  });
});

describe('shapeJobs with drafts', () => {
  it('formats drafted_at and stage_at as ISO strings', () => {
    const id = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    const rows = [{ job_id: id, status: 'DRAFTED', stage: 'drafted', drafted_at: new Date(0), stage_at: new Date(1000), edit_text: 'x' }];
    expect(shapeJobs(rows, [id], false).jobs[0]).toMatchObject({
      status: 'DRAFTED', stage: 'drafted', drafted_at: '1970-01-01T00:00:00.000Z', stage_at: '1970-01-01T00:00:01.000Z', edit_text: 'x',
    });
  });
});
