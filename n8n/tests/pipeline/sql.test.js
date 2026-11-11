import { describe, expect, it } from 'vitest';
import { CLAIM_DRAFT, DISCARD_DRAFT, SELECT_DRAFT } from '../../src/pipeline/sql-approve.js';
import { INSERT_JOB, MARK_PROCESSING, SELECT_JOBS, SET_STAGE, SWEEP_STUCK, UPDATE_JOB } from '../../src/pipeline/sql.js';
import { shapeJobs } from '../../src/pipeline/status.js';

/** The SQL is exercised live by the contract suite; these pin the guards that keep it safe. */
describe('job ledger SQL guards', () => {
  it('the sweeper only fails QUEUED/PROCESSING jobs, never drafts', () => {
    expect(SWEEP_STUCK).toMatch(/WHERE status IN \('QUEUED', 'PROCESSING'\)/);
    expect(SWEEP_STUCK).not.toMatch(/DRAFTED|DISCARDED/);
    expect(SWEEP_STUCK).toMatch(/stage = 'failed'/);
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
  it('a draft is claimed atomically: only DRAFTED, only within 24 hours', () => {
    expect(CLAIM_DRAFT).toMatch(/SET status = 'PROCESSING', stage = 'sending'/);
    expect(CLAIM_DRAFT).toMatch(/AND status = 'DRAFTED' AND drafted_at > now\(\) - interval '24 hours'/);
    expect(DISCARD_DRAFT).toMatch(/SET status = 'DISCARDED', stage = 'discarded'/);
    expect(DISCARD_DRAFT).toMatch(/AND status = 'DRAFTED'/);
    expect(SELECT_DRAFT).toMatch(/AS fresh/);
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
