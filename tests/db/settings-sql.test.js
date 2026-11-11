import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { perEnvironmentValues, settingsSql } from '../../n8n/tools/settings-sql.mjs';
import { dropDatabase, psql, scratchDatabase } from './psql.js';

/** Test-only values; each environment's real ones come from its env files and are never committed. */
const ENV = {
  EMAIL_FROM: 'sender@bookleaf.test', DEFAULT_DEMO_INBOX: 'demo@inbox.test', ALLOWED_DEMO_INBOXES: 'qa@inbox.test,qa2@inbox.test',
  ALLOW_DRILLS: 'true', ALERT_EMAIL: "o'brien@inbox.test",
};

let db;
beforeAll(() => { db = scratchDatabase(); });
afterAll(() => { if (db) dropDatabase(db); });

const stored = () => JSON.parse(psql(db, `SELECT json_object_agg(key, json_build_object('value', value, 'at', updated_at))
  FROM bookleaf_settings WHERE key IN ('email_from', 'default_demo_inbox', 'allowed_demo_inboxes', 'allow_drills', 'alert_email');`));

describe('n8n/tools/settings-sql.mjs against Postgres', () => {
  it('writes the per-environment values, typed, where bookleaf_setting() reads them', () => {
    psql(db, settingsSql(perEnvironmentValues(ENV)));
    expect(psql(db, "SELECT bookleaf_setting('email_from') #>> '{}';")).toBe('sender@bookleaf.test');
    expect(psql(db, "SELECT bookleaf_setting('allow_drills')::boolean;")).toBe('t');
    expect(psql(db, "SELECT bookleaf_setting('alert_email') #>> '{}';")).toBe("o'brien@inbox.test");
    expect(psql(db, "SELECT bookleaf_setting('allowed_demo_inboxes')::text;")).toBe('["qa@inbox.test", "qa2@inbox.test"]');
  });
  it('a fresh install seeds allowed_demo_inboxes as an empty list', () => {
    const fresh = scratchDatabase();
    try {
      expect(psql(fresh, "SELECT bookleaf_setting('allowed_demo_inboxes')::text;")).toBe('[]');
    } finally {
      dropDatabase(fresh);
    }
  });
  it('changes nothing when run again with the same values (updated_at stays)', () => {
    const before = stored();
    psql(db, settingsSql(perEnvironmentValues(ENV)));
    expect(stored()).toEqual(before);
  });
  it('updates only the settings the input names', () => {
    const before = stored();
    psql(db, settingsSql(perEnvironmentValues({ ALLOW_DRILLS: 'false' })));
    const after = stored();
    expect(after.allow_drills.value).toBe(false);
    expect(after.allow_drills.at).not.toBe(before.allow_drills.at);
    expect(after.email_from).toEqual(before.email_from);
  });
});
