import { describe, expect, it } from 'vitest';
import { readSettings } from '../../src/pipeline/settings.js';
import { RUN_MARGIN_MS, worstCaseAiMs } from '../../src/pipeline/settings-timing.js';
import { TUNING } from '../../src/pipeline/tuning.js';
import { SETTINGS } from './settings-fixture.js';

/**
 * The AI time a run can spend at worst must end before the sweeper calls the job stuck and before n8n's
 * own execution timeout: otherwise the job is marked TIMEOUT while the run keeps paying for AI calls.
 */
describe('worst-case AI time against stuck_job_minutes and the run timeout', () => {
  it('worst case = draft and rewrite × two providers × every try timing out, plus the longest waits', () => {
    const perProvider = (TUNING.aiRetries + 1) * SETTINGS.ai_timeout_ms + TUNING.aiRetries * TUNING.aiRetryMaxWaitSeconds * 1000;
    expect(worstCaseAiMs(SETTINGS)).toBe(2 * 2 * perProvider);
    expect(worstCaseAiMs(SETTINGS)).toBe(400_000);
  });
  it('the defaults fit, with the margin, inside both limits', () => {
    expect(readSettings(SETTINGS).ok).toBe(true);
    expect(worstCaseAiMs(SETTINGS) + RUN_MARGIN_MS).toBeLessThanOrEqual(Math.min(SETTINGS.stuck_job_minutes * 60_000, TUNING.runTimeoutSeconds * 1000));
  });
  it('refuses an AI timeout that could outlast stuck_job_minutes, naming both settings and the times', () => {
    const r = readSettings({ ...SETTINGS, ai_timeout_ms: 120_000, stuck_job_minutes: 10 });
    expect(r).toMatchObject({ ok: false, code: 'INTERNAL', http_status: 500 });
    expect(r.message).toContain('ai_timeout_ms (120000 ms) allows up to 1000 s of AI calls');
    expect(r.message).toContain('stuck_job_minutes (10)');
  });
  it('refuses a stuck_job_minutes shorter than the AI worst case', () => {
    expect(readSettings({ ...SETTINGS, stuck_job_minutes: 5 })).toMatchObject({ ok: false, code: 'INTERNAL' });
  });
  it('a longer stuck_job_minutes does not help past the build-time run timeout', () => {
    const r = readSettings({ ...SETTINGS, ai_timeout_ms: 120_000, stuck_job_minutes: 60 });
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toContain(`run timeout (${TUNING.runTimeoutSeconds} s`);
  });
});
