import { describe, expect, it } from 'vitest';
import { buildPrompt, feedbackMessage, PROMPT_VERSION, situationsFor, stageOf, SYSTEM_PROMPT } from '../src/prompt.js';
import { bundleOf, factsOf, SAMPLE } from './helpers-data.js';

const promptFor = (id) => buildPrompt({ bundle: bundleOf(id), facts: factsOf(id) });
const keys = (id) => situationsFor(factsOf(id)).map((s) => s.key);
const section = (user, title) => user.split('\n\n').find((b) => b.startsWith(title)) ?? '';

describe('system prompt', () => {
  it('is identical for every author (cacheable) and version-tagged', () => {
    const systems = new Set(SAMPLE.authors.map((a) => promptFor(a.author_id).system));
    expect(systems.size).toBe(1);
    expect(PROMPT_VERSION).toMatch(/^royalty-summary\.v\d+/);
  });
  it('carries the tone, policy, grounding and sign-off rules', () => {
    for (const s of ['empathetic', '₹1,000', 'within 45 days', '48 hours', 'character for character',
      'never invent a reason', 'refunds', 'WRITING STYLE', 'ADMIN STYLE NOTE', 'Indian English'])
      expect(SYSTEM_PROMPT).toContain(s);
  });
  it('leaves the signature and the word count to data and the user message', () => {
    expect(SYSTEM_PROMPT).not.toContain('150 to 350 words');
    expect(SYSTEM_PROMPT).toMatch(/Do not write a sign-off/);
    expect(PROMPT_VERSION).toBe('royalty-summary.v2');
  });
});

describe('situationsFor', () => {
  it('Farhan (all paid) gets the warm all-paid instruction only', () => expect(keys('AUTH008')).toEqual(['ALL_PAID']));
  it('Kavita (BK016, ₹850 pending) gets BELOW_THRESHOLD instead of the overdue escalation', () => {
    expect(keys('AUTH009')).toContain('BELOW_THRESHOLD');
    expect(keys('AUTH009')).not.toContain('OVERDUE');
  });
  it('Rohit (overdue + pending) gets OVERDUE and PENDING', () => expect(keys('AUTH002')).toEqual(['OVERDUE', 'PENDING']));
  it('Sneha lists her in-production book with its stage', () => {
    const s = situationsFor(factsOf('AUTH007')).find((x) => x.key === 'IN_PRODUCTION');
    expect(s.text).toContain('(stage: Cover Design)');
  });
  it('an author with only books in production gets NO_SALES_YET', () => {
    const facts = factsOf('AUTH009');
    const only = { ...facts, books: facts.books.filter((b) => b.badge === 'NONE'), totals: { earned: 0, paid: 0, pending: 0 }, allPaid: false };
    expect(situationsFor(only).map((s) => s.key)).toEqual(['NO_SALES_YET', 'IN_PRODUCTION']);
  });
});

describe('buildPrompt user message', () => {
  it('greets by first name and states the dates as display values', () => {
    const { user } = promptFor('AUTH001');
    expect(user).toContain('Author first name: Priya');
    expect(user).toContain('Figures as of: 31 Dec 2025');
    expect(user).toContain('Next payout cycle closes by: 14 Feb 2026');
  });
  it('lists every fact as id | label | display', () => {
    const { user } = promptFor('AUTH002');
    for (const f of factsOf('AUTH002').facts) expect(user).toContain(`- ${f.id} | ${f.label} | ${f.display}`);
  });
  it('per-book lines use rupee display values and the status text', () => {
    const books = section(promptFor('AUTH009').user, 'BOOKS');
    expect(books).toContain('BK016');
    expect(books).toContain('pending ₹850');
    expect(books).toMatch(/BK015 \| ".*" \| In Production - Typesetting \| in production, no sales yet/);
  });
  it('no fact id leaks into the instruction text the model writes from', () => {
    for (const a of SAMPLE.authors) {
      const { user } = promptFor(a.author_id);
      const instructions = section(user, 'SITUATIONS THAT APPLY');
      expect(instructions).not.toMatch(/\b(book\.BK\d+|totals\.|kb\.|payout\.next_date|reference\.date|author\.book_count)/);
    }
  });
  it('reports the situation keys it used', () => expect(promptFor('AUTH008').situations).toEqual(['ALL_PAID']));
  it('ends with the writing style (warm, standard length by default)', () => {
    const { user } = promptFor('AUTH001');
    expect(section(user, 'WRITING STYLE')).toMatch(/Tone: warm[\s\S]*150 to 300 words/);
  });
});

describe('helpers', () => {
  it('stageOf strips the "In Production -" prefix', () => {
    expect(stageOf('In Production - Typesetting')).toBe('Typesetting');
    expect(stageOf('In Production')).toBe('In Production');
  });
  it('feedbackMessage lists issues with excerpts, capped at 10', () => {
    const issues = Array.from({ length: 12 }, (_, i) => ({ code: 'X', message: `Amount ${i} is wrong.`, excerpt: `₹${i}` }));
    const msg = feedbackMessage(issues);
    expect(msg).toContain('Amount 0 is wrong. (you wrote: "₹0")');
    expect(msg).not.toContain('Amount 10');
    expect(msg).toContain('Write the complete JSON again');
  });
});
