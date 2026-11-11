import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

describe('public API', () => {
  it('exports the workflow entry points', () => {
    for (const n of ['bundleFromSample', 'validateEnqueue', 'validateBundle', 'checkIntegrity', 'buildFacts', 'checkEmail',
      'renderEmail', 'getProvider', 'costUsd',
      'formatInr', 'payoutDeadlineFor'])
      expect(typeof api[n], n).toBe('function');
  });
  it('has no Bubble Data API or push-callback helpers (n8n never calls Bubble)', () => {
    for (const n of ['authorQuery', 'booksQuery', 'royaltiesQuery', 'bundleFromBubble', 'callbackRequest']) expect(api, n).not.toHaveProperty(n);
  });
});
