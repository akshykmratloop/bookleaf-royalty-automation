import { describe, expect, it } from 'vitest';
import { spokenRupeesToFigures, wordsToDigits } from '../src/checker/number-words.js';

describe('wordsToDigits', () => {
  it.each([
    ['three thousand five hundred and seventy rupees', '3570 rupees'],
    ['one thousand rupees', '1000 rupees'],
    ['forty-eight hours', '48 hours'],
    ['five to seven business days', '5 to 7 business days'],
    ['two lakh fifty thousand rupees', '250000 rupees'],
    ['teen hazaar rupees nahi, three hazaar rupees', 'teen hazaar rupees nahi, 3000 rupees'],
    ['one crore', '10000000'],
    ['twelve copies', '12 copies'],
  ])('%s → %s', (spoken, digits) => expect(wordsToDigits(spoken)).toBe(digits));

  it('leaves ordinary words and digits alone', () => {
    expect(wordsToDigits('Namaste Priya ji, ₹3,570 is pending')).toBe('Namaste Priya ji, ₹3,570 is pending');
    expect(wordsToDigits('someone, anyone, often')).toBe('someone, anyone, often');
  });
});

describe('spokenRupeesToFigures', () => {
  it.each([
    ['The pending amount is three thousand five hundred and seventy rupees.', 'The pending amount is ₹3,570.'],
    ['One lakh rupees, paid in full.', '₹1,00,000, paid in full.'],
    ['just one rupee', 'just ₹1'],
  ])('%s → %s', (spoken, shown) => expect(spokenRupeesToFigures(spoken)).toBe(shown));
  it.each(['Give me one moment, please.', 'Teen hazaar rupees nahi.'])('leaves %s alone', (t) =>
    expect(spokenRupeesToFigures(t)).toBe(t));
});
