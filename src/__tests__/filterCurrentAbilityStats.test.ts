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

  it('folds an orphan ADS template by ability_type when names differ (Ashe pattern)', () => {
    const hero: Hero = {
      slug: 'ashe',
      name: 'Ashe',
      role: 'damage',
      abilities: [{ name: 'The Viper', description: '' }],
      perks: { minor: [], major: [] },
      stats: { abilities: {} },
    };
    const input: Record<string, AbilityStat> = {
      'The Viper': { ability_type: 'Weapon;;Hip Fire', damage: 35 },
      'Take Aim (ADS)': { ability_type: 'Weapon;;ADS', damage: 75 },
    };
    const result = filterCurrentAbilityStats(input, hero);
    expect(Object.keys(result)).toEqual(['The Viper']);
    expect(result['The Viper']?.modes?.ADS).toEqual({ damage: 75 });
  });

  it('folds an orphan Secondary Fire template by ability_type (Sojourn pattern)', () => {
    const hero: Hero = {
      slug: 'sojourn',
      name: 'Sojourn',
      role: 'damage',
      abilities: [{ name: 'Railgun', description: '' }],
      perks: { minor: [], major: [] },
      stats: { abilities: {} },
    };
    const input: Record<string, AbilityStat> = {
      Railgun: { ability_type: 'Weapon;;Primary Fire', damage: 9 },
      'Charged Shot': { ability_type: 'Weapon;;Secondary Fire', damage: 120 },
    };
    const result = filterCurrentAbilityStats(input, hero);
    expect(Object.keys(result)).toEqual(['Railgun']);
    expect(result['Railgun']?.modes?.['Secondary Fire']).toEqual({ damage: 120 });
  });

  it('hoists a primary-fire orphan into output when Blizzard surfaces neither weapon (Mauga pattern)', () => {
    const hero: Hero = {
      slug: 'mauga',
      name: 'Mauga',
      role: 'tank',
      abilities: [{ name: 'Berserker', description: '' }],
      perks: { minor: [], major: [] },
      stats: { abilities: {} },
    };
    const input: Record<string, AbilityStat> = {
      'Incendiary Chaingun': { ability_type: 'Weapon;;Primary Fire', damage: 4 },
      'Volatile Chaingun': { ability_type: 'Weapon;;Secondary Fire', damage: 5 },
    };
    const result = filterCurrentAbilityStats(input, hero);
    expect(Object.keys(result)).toEqual(['Incendiary Chaingun']);
    expect(result['Incendiary Chaingun']?.modes?.['Secondary Fire']).toEqual({ damage: 5 });
  });

  it('throws when an alternate-mode orphan has no anchor (ambiguous data, not silent drop)', () => {
    const hero: Hero = {
      slug: 'mystery',
      name: 'Mystery',
      role: 'damage',
      abilities: [{ name: 'Something', description: '' }],
      perks: { minor: [], major: [] },
      stats: { abilities: {} },
    };
    const input: Record<string, AbilityStat> = {
      'Mystery Scope': { ability_type: 'Weapon;;ADS', damage: 99 },
    };
    expect(() => filterCurrentAbilityStats(input, hero)).toThrow(/no Primary\/Hip Fire anchor/);
  });

  it('throws when multiple primary-fire anchors exist with an alternate-mode orphan', () => {
    const hero: Hero = {
      slug: 'mystery',
      name: 'Mystery',
      role: 'damage',
      abilities: [
        { name: 'Rifle A', description: '' },
        { name: 'Rifle B', description: '' },
      ],
      perks: { minor: [], major: [] },
      stats: { abilities: {} },
    };
    const input: Record<string, AbilityStat> = {
      'Rifle A': { ability_type: 'Weapon;;Primary Fire', damage: 10 },
      'Rifle B': { ability_type: 'Weapon;;Primary Fire', damage: 20 },
      'Scoped Shot': { ability_type: 'Weapon;;ADS', damage: 50 },
    };
    expect(() => filterCurrentAbilityStats(input, hero)).toThrow(/cannot disambiguate/);
  });

  it('matches Fandom "X" to Blizzard "X (suffix)" when the Fandom name lacks the parenthetical', () => {
    const hero: Hero = {
      slug: 'ramattra',
      name: 'Ramattra',
      role: 'tank',
      abilities: [
        { name: 'Void Accelerator (Omnic Form)', description: 'Fire a stream of projectiles.' },
        { name: 'Pummel (Nemesis Form)', description: 'Punch.' },
      ],
      perks: { minor: [], major: [] },
      stats: { abilities: {} },
    };
    const input: Record<string, AbilityStat> = {
      'Void Accelerator': { ability_type: 'Weapon', damage: 6 },
      Pummel: { ability_type: 'Ability', damage: 40 },
    };
    const result = filterCurrentAbilityStats(input, hero);
    expect(Object.keys(result).sort()).toEqual(['Pummel (Nemesis Form)', 'Void Accelerator (Omnic Form)']);
    expect(result['Void Accelerator (Omnic Form)']?.damage).toBe(6);
    expect(result['Pummel (Nemesis Form)']?.damage).toBe(40);
  });

  it('throws when a Fandom name matches multiple Blizzard parenthetical variants', () => {
    const hero: Hero = {
      slug: 'ambig',
      name: 'Ambig',
      role: 'damage',
      abilities: [
        { name: 'Rifle (Form A)', description: '' },
        { name: 'Rifle (Form B)', description: '' },
      ],
      perks: { minor: [], major: [] },
      stats: { abilities: {} },
    };
    const input: Record<string, AbilityStat> = {
      Rifle: { damage: 10 },
    };
    expect(() => filterCurrentAbilityStats(input, hero)).toThrow(/matches multiple Blizzard parenthetical/);
  });

  it('folds a key=secondary fire orphan under the sole primary weapon (Reaper Dire Triggers pattern)', () => {
    const hero: Hero = {
      slug: 'reaper',
      name: 'Reaper',
      role: 'damage',
      abilities: [
        { name: 'Hellfire Shotguns', description: 'Short-range spread weapons.' },
        { name: 'Shadow Step', description: 'Teleport.' },
      ],
      perks: { minor: [], major: [] },
      stats: { abilities: {} },
    };
    const input: Record<string, AbilityStat> = {
      'Hellfire Shotguns': { ability_type: 'Weapon', damage: 115 },
      'Shadow Step': { ability_type: 'Ability', cooldown: '10 seconds' },
      'Dire Triggers': { ability_type: 'Ability', key: 'secondary fire', damage: 69, cast_time: '0.5 seconds' },
    };
    const result = filterCurrentAbilityStats(input, hero);
    expect(Object.keys(result).sort()).toEqual(['Hellfire Shotguns', 'Shadow Step']);
    expect(result['Hellfire Shotguns']?.modes?.['Secondary Fire']?.damage).toBe(69);
    expect(result['Hellfire Shotguns']?.modes?.['Secondary Fire']?.cast_time).toBe('0.5 seconds');
  });

  it('folds a key=secondary fire orphan via perk-description mention (Junker Queen Jagged Blade pattern)', () => {
    const hero: Hero = {
      slug: 'junker-queen',
      name: 'Junker Queen',
      role: 'tank',
      abilities: [
        { name: 'Scattergun', description: 'Fires a spread of pellets.' },
        { name: 'Carnage', description: 'Swing your axe.' },
      ],
      perks: {
        minor: [
          { name: 'Willy-Willy', description: 'Jagged Blade spins on impact and pulls enemies in.' },
          { name: 'Other Minor', description: 'unrelated' },
        ],
        major: [
          { name: 'Some Major', description: 'unrelated' },
          { name: 'Another Major', description: 'unrelated' },
        ],
      },
      stats: { abilities: {} },
    };
    const input: Record<string, AbilityStat> = {
      Scattergun: { ability_type: 'Weapon', damage: 80 },
      Carnage: { ability_type: 'Ability', damage: 90 },
      'Jagged Blade': { ability_type: 'Ability', key: 'secondary fire', damage: 75 },
    };
    const result = filterCurrentAbilityStats(input, hero);
    expect(Object.keys(result).sort()).toEqual(['Carnage', 'Scattergun']);
    expect(result['Scattergun']?.modes?.['Secondary Fire']?.damage).toBe(75);
  });

  it('throws on a key=secondary fire orphan when no parent can be identified (Ramattra Block pattern)', () => {
    const hero: Hero = {
      slug: 'ramattra',
      name: 'Ramattra',
      role: 'tank',
      abilities: [
        { name: 'Void Accelerator (Omnic Form)', description: 'Fire a stream of projectiles.' },
        { name: 'Pummel (Nemesis Form)', description: 'Punch, creating a wave.' },
      ],
      perks: { minor: [], major: [] },
      stats: { abilities: {} },
    };
    const input: Record<string, AbilityStat> = {
      'Void Accelerator': { ability_type: 'Weapon', damage: 6 },
      Pummel: { ability_type: 'Ability;;Nemesis Form', damage: 40 },
      Block: { ability_type: 'Ability', key: 'secondary fire', cooldown: '0' },
    };
    // Ramattra's form-split abilities ("(Omnic Form)" / "(Nemesis Form)") mean we can't
    // safely assume the lone primary weapon is Block's parent. Expect a throw so the
    // hero is surfaced via fandom_failed instead of being misplaced.
    expect(() => filterCurrentAbilityStats(input, hero)).toThrow(/no parent ability can be identified/);
  });
});
