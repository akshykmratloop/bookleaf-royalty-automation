import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

describe('public API', () => {
  it('exports the workflow entry points', () => {
    for (const n of ['bundleFromSample', 'validateEnqueue', 'validateBundle', 'checkIntegrity', 'buildFacts', 'checkEmail',
      'renderEmail', 'getProvider', 'costUsd', 'authorQuery', 'booksQuery', 'royaltiesQuery', 'bundleFromBubble', 'callbackRequest',
      'formatInr', 'payoutDeadlineFor'])
      expect(typeof api[n], n).toBe('function');
  });
});
