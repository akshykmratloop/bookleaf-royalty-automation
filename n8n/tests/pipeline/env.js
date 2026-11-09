/** A complete, valid server environment for pipeline tests. */
export const ENV = Object.freeze({
  DATA_SOURCE: 'payload', CALLBACK_MODE: 'pull', MAX_SENDS_PER_HOUR: '60', REFERENCE_DATE_DEFAULT: '2025-12-31',
  ALLOW_DRILLS: 'true', DEFAULT_DEMO_INBOX: 'demo@inbox.test', EMAIL_FROM: 'sender@bookleaf.test',
  AI_PRIMARY_MODEL: 'claude-sonnet-5-5', AI_FALLBACK_MODEL: 'gpt-4.1-mini', AI_EFFORT: 'medium', BUBBLE_APP_BASE: '',
});
export const NOW = Date.UTC(2026, 10, 10, 6, 0, 0);
export const fixedRandom = () => Array.from({ length: 16 }, (_, i) => i * 17);
