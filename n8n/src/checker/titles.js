import { MONTH } from './patterns.js';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const FIGURE_WORDS = new RegExp(
  `\\b(?:${MONTH}|rs|inr|rupees?|usd|eur|gbp|lakhs?|crores?|k|of|days?|hours?|weeks?|months?|quarters?|years?|business|working)\\b`,
  'gi',
);

/**
 * A title made only of figure characters ("₹50,000", "14 Feb 2026", "45 days") would whitelist
 * that very figure, so it is never exempted.
 */
export function isFigureLike(title) {
  return title.replace(FIGURE_WORDS, '').replace(/[\d\s\p{Sc}.,:/%–-]/gu, '') === '';
}

/** Removes a book title in any case, only where it stands as whole words. */
export function stripTitle(text, title) {
  if (!title || isFigureLike(title)) return text;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(title)}(?![\\p{L}\\p{N}])`, 'giu');
  return text.replace(re, ' ');
}
