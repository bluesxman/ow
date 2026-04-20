import { describe, it, expect } from 'vitest';
import { filterCurrentAbilityStats } from '../sources/enrichFromFandom.js';
import type { AbilityStat, Hero } from '../types.js';

function cassidyLike(): Hero {
  return {
    slug: 'cassidy',
    name: 'Cassidy',
    role: 'damage',
    abilities: [
      { name: 'Peacekeeper', description: '' },
      { name: 'Combat Roll', description: '' },
      { name: 'Deadeye', description: '' },
    ],
    perks: {
      minor: [
        { name: 'Bang Bang', description: '' },
        { name: 'Even The Odds', description: '' },
      ],
      major: [
        { name: "Rollin' Round-Up", description: '' },
        { name: 'Silver Bullet', description: '' },
      ],
    },
    stats: { abilities: {} },
  };
}

const stat = (cooldown: string): AbilityStat => ({ cooldown });

describe('filterCurrentAbilityStats', () => {
  it('keeps names matching Blizzard abilities and perks', () => {
    const hero = cassidyLike();
    const input: Record<string, AbilityStat> = {
      Peacekeeper: stat('n/a'),
      'Combat Roll': stat('6 seconds'),
      Deadeye: stat('120 seconds'),
      'Bang Bang': stat('perk'),
      "Rollin' Round-Up": stat('perk'),
    };
    expect(filterCurrentAbilityStats(input, hero)).toEqual(input);
  });

  it('drops entries with (old) suffix', () => {
    const hero = cassidyLike();
    const result = filterCurrentAbilityStats(
      { 'Flashbang (old)': stat('8s'), 'Magnetic Grenade (old)': stat('10s') },
      hero,
    );
    expect(result).toEqual({});
  });

  it('drops abilities that were removed entirely', () => {
    const hero = cassidyLike();
    const result = filterCurrentAbilityStats(
      { Flashbang: stat('8s'), 'Magnetic Grenade': stat('10s'), 'Fan the Hammer': stat('') },
      hero,
    );
    expect(result).toEqual({});
  });

  it('drops removed perks by name', () => {
    const hero = cassidyLike();
    const result = filterCurrentAbilityStats(
      { 'Past Noon': stat(''), 'Quick Draw': stat(''), "Gun Slingin'": stat('') },
      hero,
    );
    expect(result).toEqual({});
  });

  it('matches case-insensitively to tolerate Fandom/Blizzard casing drift', () => {
    const hero = cassidyLike();
    const result = filterCurrentAbilityStats({ 'Even the Odds': stat('perk') }, hero);
    expect(result).toEqual({ 'Even the Odds': stat('perk') });
  });

  it('preserves the original Fandom casing in the output key', () => {
    const hero = cassidyLike();
    const result = filterCurrentAbilityStats({ 'even the odds': stat('perk') }, hero);
    expect(Object.keys(result)).toEqual(['even the odds']);
  });

  it('returns empty when none of the Fandom entries match', () => {
    const hero = cassidyLike();
    const result = filterCurrentAbilityStats({ SomethingElse: stat('x') }, hero);
    expect(result).toEqual({});
  });
});
