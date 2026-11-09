import { readFileSync } from 'node:fs';
import { bundleFromSample } from '../src/normalize.js';
import { buildFacts } from '../src/facts.js';
import { checkEmail } from '../src/checker/index.js';

const data = JSON.parse(readFileSync(new URL('../../data/bookleaf_sample_data.json', import.meta.url), 'utf8'));
/** Facts for AUTH001 (Priya): pending ₹3,570, next payout 14 Feb 2026, threshold ₹1,000, 45 days. */
export const priyaFacts = buildFacts(bundleFromSample(data.authors[0]), '2025-12-31').facts;
/** Test adapter: body/facts/ignorePhrases -> checkEmail. */
export const checkReply = ({ body, facts = priyaFacts, ignorePhrases = [] }) =>
  checkEmail({ text: body, facts, titles: ignorePhrases });
