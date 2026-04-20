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

  it('folds parenthetical-suffixed twin templates into base.modes', () => {
    const hero: Hero = {
      slug: 'emre',
      name: 'Emre',
      role: 'damage',
      abilities: [{ name: 'Synthetic Burst Rifle', description: '' }],
      perks: { minor: [], major: [] },
      stats: { abilities: {} },
    };
    const input: Record<string, AbilityStat> = {
      'Synthetic Burst Rifle': { ability_type: 'Weapon (Hip Fire)', damage: 22, damage_falloff_range: '25 - 40 meters' },
      'Synthetic Burst Rifle (ADS)': { ability_type: 'Weapon (ADS)', damage: 22, damage_falloff_range: '35 - 50 meters' },
    };
    const result = filterCurrentAbilityStats(input, hero);
    expect(Object.keys(result)).toEqual(['Synthetic Burst Rifle']);
    const base = result['Synthetic Burst Rifle']!;
    expect(base.damage).toBe(22);
    expect(base.damage_falloff_range).toBe('25 - 40 meters');
    expect(base.modes?.ADS).toEqual({ damage: 22, damage_falloff_range: '35 - 50 meters' });
  });

  it('drops a suffixed template when its base name is not a current ability', () => {
    const hero = cassidyLike();
    const result = filterCurrentAbilityStats(
      { 'Flashbang (old)': stat('8s') },
      hero,
    );
    expect(result).toEqual({});
  });

  it('derives the mode key from the parenthetical suffix when ability_type has none', () => {
    const hero: Hero = {
      slug: 'emre',
      name: 'Emre',
      role: 'damage',
      abilities: [{ name: 'Synthetic Burst Rifle', description: '' }],
      perks: { minor: [], major: [] },
      stats: { abilities: {} },
    };
    const input: Record<string, AbilityStat> = {
      'Synthetic Burst Rifle': { damage: 22 },
      'Synthetic Burst Rifle (Scoped)': { damage: 30 },
    };
    const result = filterCurrentAbilityStats(input, hero);
    expect(result['Synthetic Burst Rifle']?.modes?.Scoped).toEqual({ damage: 30 });
  });
});
