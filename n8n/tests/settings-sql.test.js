import { describe, expect, it } from 'vitest';
import { ENV_NAMES, perEnvironmentValues, settingsSql } from '../tools/settings-sql.mjs';
import { parseEnvText } from '../tools/env-file.mjs';
import { SETTINGS_SCHEMA } from '../src/pipeline/settings.js';

/** Test-only addresses; real values live in env files and are never printed or committed. */
const ENV = { EMAIL_FROM: 'sender@bookleaf.test', DEFAULT_DEMO_INBOX: 'demo@inbox.test', ALLOW_DRILLS: 'true', ALERT_EMAIL: 'ops@inbox.test' };

describe('perEnvironmentValues', () => {
  it('reads exactly the per-environment settings, by their upper-case names', () => {
    expect(ENV_NAMES).toEqual({ EMAIL_FROM: 'email_from', DEFAULT_DEMO_INBOX: 'default_demo_inbox', ALLOW_DRILLS: 'allow_drills', ALERT_EMAIL: 'alert_email' });
    expect(Object.values(ENV_NAMES)).toEqual(Object.keys(SETTINGS_SCHEMA).filter((k) => SETTINGS_SCHEMA[k].perEnvironment));
    expect(perEnvironmentValues(ENV)).toEqual({
      email_from: 'sender@bookleaf.test', default_demo_inbox: 'demo@inbox.test', allow_drills: true, alert_email: 'ops@inbox.test',
    });
  });
  it('ignores other names (the old $env workflow settings) and leaves unnamed settings alone', () => {
    expect(perEnvironmentValues({ DEFAULT_DEMO_INBOX: 'demo@inbox.test', DATA_SOURCE: 'payload', MAX_SENDS_PER_HOUR: '5' }))
      .toEqual({ default_demo_inbox: 'demo@inbox.test' });
  });
  it('takes the sender from the SMTP account when EMAIL_FROM is not given', () => {
    expect(perEnvironmentValues({ SMTP_USER_EMAIL: 'smtp@bookleaf.test' })).toEqual({ email_from: 'smtp@bookleaf.test' });
    expect(perEnvironmentValues({ SMTP_USER_EMAIL: 'smtp@bookleaf.test', EMAIL_FROM: 'sender@bookleaf.test' }).email_from).toBe('sender@bookleaf.test');
  });
  it('accepts empty inbox and alert values (they switch the feature off) and ALLOW_DRILLS=false', () => {
    expect(perEnvironmentValues({ DEFAULT_DEMO_INBOX: '', ALERT_EMAIL: '', ALLOW_DRILLS: 'false' }))
      .toEqual({ default_demo_inbox: '', alert_email: '', allow_drills: false });
  });
  it('refuses bad values, naming the variable but never the value', () => {
    const bad = () => perEnvironmentValues({ EMAIL_FROM: 'secret-looking-value', ALLOW_DRILLS: 'yes', ALERT_EMAIL: 'x@' });
    expect(bad).toThrow(/EMAIL_FROM: email_from must be an email address/);
    expect(bad).toThrow(/ALLOW_DRILLS: must be true or false/);
    expect(bad).toThrow(/ALERT_EMAIL: alert_email must be an email address, or empty/);
    expect(bad).not.toThrow(/secret-looking-value/);
    expect(() => perEnvironmentValues({ EMAIL_FROM: '' })).toThrow(/EMAIL_FROM/);
  });
  it('refuses input that names none of them', () => {
    expect(() => perEnvironmentValues({ DATA_SOURCE: 'payload' })).toThrow(/none of EMAIL_FROM, DEFAULT_DEMO_INBOX, ALLOW_DRILLS, ALERT_EMAIL/);
  });
});

describe('settingsSql', () => {
  const sql = settingsSql({ email_from: "o'brien@bookleaf.test", allow_drills: true });
  it('is one transaction of upserts that change a row only when its value differs', () => {
    expect(sql.startsWith('BEGIN;\n')).toBe(true);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(sql.match(/INSERT INTO bookleaf_settings/g)).toHaveLength(2);
    expect(sql).toContain('ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()');
    expect(sql).toContain('WHERE bookleaf_settings.value IS DISTINCT FROM EXCLUDED.value;');
  });
  it('writes JSON values as escaped SQL literals, with the schema description', () => {
    expect(sql).toContain(`('email_from', '"o''brien@bookleaf.test"', '${SETTINGS_SCHEMA.email_from.description.replaceAll("'", "''")}')`);
    expect(sql).toContain("('allow_drills', 'true', ");
  });
  it('refuses keys that are not per-environment settings, and an empty set', () => {
    expect(() => settingsSql({ max_sends_per_hour: 5 })).toThrow(/max_sends_per_hour is not a per-environment setting/);
    expect(() => settingsSql({})).toThrow(/nothing to write/);
  });
});

describe('parseEnvText', () => {
  it('reads KEY=value lines with comments, export and quotes', () => {
    expect(parseEnvText('# c\nexport A=1\nB="two words" \nC=three # note\n\nnot a line\n')).toEqual({ A: '1', B: 'two words', C: 'three' });
  });
});
