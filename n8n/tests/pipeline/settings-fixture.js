import { SETTINGS_SCHEMA } from '../../src/pipeline/settings.js';

/** A complete, valid bookleaf_settings table for pipeline tests: the seeded defaults plus this test environment's own values. */
export const SETTINGS = Object.freeze({
  ...Object.fromEntries(Object.entries(SETTINGS_SCHEMA).map(([k, s]) => [k, s.default])),
  email_from: 'sender@bookleaf.test', default_demo_inbox: 'demo@inbox.test', allow_drills: true, alert_email: 'ops@inbox.test',
});
export const NOW = Date.UTC(2026, 10, 10, 6, 0, 0);
export const fixedRandom = () => Array.from({ length: 16 }, (_, i) => i * 17);
