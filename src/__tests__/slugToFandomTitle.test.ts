import { describe, it, expect } from 'vitest';
import { slugToFandomTitle, slugToFandomUrl, slugToBlizzardUrl } from '../sources/slugToFandomTitle.js';

describe('slugToFandomTitle', () => {
  it('title-cases a simple slug', () => {
    expect(slugToFandomTitle('reaper')).toBe('Reaper');
  });

  it('title-cases multi-part slugs joined with spaces', () => {
    expect(slugToFandomTitle('ana')).toBe('Ana');
    expect(slugToFandomTitle('mei')).toBe('Mei');
  });

  it('uses override for soldier-76', () => {
    expect(slugToFandomTitle('soldier-76')).toBe('Soldier: 76');
  });

  it('uses override for dva', () => {
    expect(slugToFandomTitle('dva')).toBe('D.Va');
  });

  it('uses override for lucio', () => {
    expect(slugToFandomTitle('lucio')).toBe('Lúcio');
  });

  it('uses override for torbjorn', () => {
    expect(slugToFandomTitle('torbjorn')).toBe('Torbjörn');
  });

  it('uses override for wrecking-ball', () => {
    expect(slugToFandomTitle('wrecking-ball')).toBe('Wrecking Ball');
  });

  it('uses override for junker-queen', () => {
    expect(slugToFandomTitle('junker-queen')).toBe('Junker Queen');
  });
});

describe('slugToFandomUrl', () => {
  it('builds a wiki URL with underscored title', () => {
    expect(slugToFandomUrl('reaper')).toBe('https://overwatch.fandom.com/wiki/Reaper');
  });

  it('encodes the colon in soldier-76', () => {
    expect(slugToFandomUrl('soldier-76')).toBe(
      'https://overwatch.fandom.com/wiki/Soldier%3A_76',
    );
  });

  it('encodes accented characters', () => {
    const url = slugToFandomUrl('lucio');
    expect(url.startsWith('https://overwatch.fandom.com/wiki/')).toBe(true);
    expect(decodeURIComponent(url)).toBe('https://overwatch.fandom.com/wiki/Lúcio');
  });

  it('underscores spaces in multi-word names', () => {
    expect(slugToFandomUrl('wrecking-ball')).toBe(
      'https://overwatch.fandom.com/wiki/Wrecking_Ball',
    );
  });
});

describe('slugToBlizzardUrl', () => {
  it('builds a Blizzard hero URL', () => {
    expect(slugToBlizzardUrl('reaper')).toBe(
      'https://overwatch.blizzard.com/en-us/heroes/reaper/',
    );
  });

  it('preserves the slug as-is', () => {
    expect(slugToBlizzardUrl('soldier-76')).toBe(
      'https://overwatch.blizzard.com/en-us/heroes/soldier-76/',
    );
  });
});
