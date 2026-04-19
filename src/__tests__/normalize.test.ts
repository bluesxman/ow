import { describe, it, expect } from 'vitest';
import {
  normalizeText,
  normalizeRole,
  normalizeForCompare,
  parseNumeric,
} from '../normalize.js';

describe('normalizeText', () => {
  it('collapses whitespace including nbsp', () => {
    expect(normalizeText('foo\u00a0 \n bar')).toBe('foo bar');
  });

  it('trims ends', () => {
    expect(normalizeText('  hello  ')).toBe('hello');
  });
});

describe('normalizeRole', () => {
  it('maps canonical names', () => {
    expect(normalizeRole('Tank')).toBe('tank');
    expect(normalizeRole('Damage')).toBe('damage');
    expect(normalizeRole('Support')).toBe('support');
  });

  it('maps DPS and offense to damage', () => {
    expect(normalizeRole('DPS')).toBe('damage');
    expect(normalizeRole('Offense')).toBe('damage');
  });

  it('returns null for unknown', () => {
    expect(normalizeRole('Flex')).toBe(null);
  });
});

describe('normalizeForCompare', () => {
  it('strips punctuation, diacritics, casing', () => {
    expect(normalizeForCompare("Soul-Reaving!")).toBe('soulreaving');
    expect(normalizeForCompare('Soul  Reaving')).toBe('soulreaving');
    expect(normalizeForCompare('Lúcio')).toBe('lucio');
  });
});

describe('parseNumeric', () => {
  it('parses pure numbers', () => {
    expect(parseNumeric('250')).toBe(250);
    expect(parseNumeric('12.5')).toBe(12.5);
  });

  it('falls back to string for units', () => {
    expect(parseNumeric('12s')).toBe('12s');
    expect(parseNumeric('20m')).toBe('20m');
  });

  it('strips thousands separators', () => {
    expect(parseNumeric('1,000')).toBe(1000);
  });

  it('returns undefined for empty', () => {
    expect(parseNumeric('')).toBeUndefined();
    expect(parseNumeric(undefined)).toBeUndefined();
  });
});
