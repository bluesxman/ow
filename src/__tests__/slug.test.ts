import { describe, it, expect } from 'vitest';
import { toSlug, isValidSlug } from '../slug.js';

describe('toSlug', () => {
  it('handles Soldier: 76 edge case', () => {
    expect(toSlug('Soldier: 76')).toBe('soldier-76');
  });

  it('strips diacritics for Lúcio', () => {
    expect(toSlug('Lúcio')).toBe('lucio');
  });

  it('strips diacritics for Torbjörn', () => {
    expect(toSlug('Torbjörn')).toBe('torbjorn');
  });

  it('handles Wrecking Ball', () => {
    expect(toSlug('Wrecking Ball')).toBe('wrecking-ball');
  });

  it('handles D.Va', () => {
    expect(toSlug('D.Va')).toBe('dva');
  });

  it('handles Junker Queen', () => {
    expect(toSlug('Junker Queen')).toBe('junker-queen');
  });

  it('handles plain single-word heroes', () => {
    expect(toSlug('Reaper')).toBe('reaper');
    expect(toSlug('Vendetta')).toBe('vendetta');
    expect(toSlug('Genji')).toBe('genji');
  });

  it('collapses repeated separators', () => {
    expect(toSlug('  Junker   Queen  ')).toBe('junker-queen');
  });
});

describe('isValidSlug', () => {
  it('accepts well-formed slugs', () => {
    expect(isValidSlug('reaper')).toBe(true);
    expect(isValidSlug('soldier-76')).toBe(true);
    expect(isValidSlug('wrecking-ball')).toBe(true);
  });

  it('rejects leading/trailing hyphens', () => {
    expect(isValidSlug('-reaper')).toBe(false);
    expect(isValidSlug('reaper-')).toBe(false);
  });

  it('rejects empty and uppercase', () => {
    expect(isValidSlug('')).toBe(false);
    expect(isValidSlug('Reaper')).toBe(false);
  });

  it('rejects double hyphens', () => {
    expect(isValidSlug('junker--queen')).toBe(false);
  });
});
