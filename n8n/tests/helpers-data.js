import { readFileSync } from 'node:fs';
import { bundleFromSample } from '../src/normalize.js';
import { buildFacts } from '../src/facts.js';

export const SAMPLE = JSON.parse(readFileSync(new URL('../../data/bookleaf_sample_data.json', import.meta.url), 'utf8'));
export const REF = '2025-12-31';
export const sampleAuthor = (id) => SAMPLE.authors.find((a) => a.author_id === id);
export const bundleOf = (id) => bundleFromSample(sampleAuthor(id));
export const factsOf = (id, ref = REF) => buildFacts(bundleOf(id), ref);
