import { describe, expect, it } from 'vitest';
import { formatInr, toPaise } from '../src/money.js';

describe('money', () => {
  it('formats with Indian grouping', () => {
    expect(formatInr(0)).toBe('₹0');
    expect(formatInr(850)).toBe('₹850');
    expect(formatInr(1000)).toBe('₹1,000');
    expect(formatInr(100000)).toBe('₹1,00,000');
    expect(formatInr(12345678)).toBe('₹1,23,45,678');
  });
  it('converts to paise', () => {
    expect(toPaise(3570)).toBe(357000);
  });
});
