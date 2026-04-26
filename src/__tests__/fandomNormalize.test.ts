import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  extractSections,
  normalizeAbility,
  normalizeFandomHero,
  normalizeInfoboxHP,
  normalizeSubRole,
} from '../sources/fandomNormalize.js';

const here = dirname(fileURLToPath(import.meta.url));

function loadFixtureWikitext(name: string): string {
  const raw = readFileSync(resolve(here, 'fixtures', name), 'utf8');
  const parsed = JSON.parse(raw) as { parse: { wikitext: { '*': string } } };
  return parsed.parse.wikitext['*'];
}

describe('normalizeInfoboxHP', () => {
  it('returns empty when infobox is null', () => {
    expect(normalizeInfoboxHP(null)).toEqual({});
  });

  it('extracts numeric health/armor/shield', () => {
    const tpl = {
      name: 'Infobox character',
      params: { health: '175', armor: '75', shield: '50' },
    };
    expect(normalizeInfoboxHP(tpl)).toEqual({ health: 175, armor: 75, shields: 50 });
  });

  it('skips non-numeric HP fields', () => {
    const tpl = { name: 'Infobox character', params: { health: 'unknown' } };
    expect(normalizeInfoboxHP(tpl)).toEqual({});
  });

  it('accepts shields plural alias', () => {
    const tpl = { name: 'Infobox character', params: { shields: '100' } };
    expect(normalizeInfoboxHP(tpl)).toEqual({ shields: 100 });
  });

  it('adds the +150 role-queue passive to tank health', () => {
    const tpl = {
      name: 'Infobox character',
      params: { role: '[[Tank]]', health: '250', armor: '300' },
    };
    expect(normalizeInfoboxHP(tpl)).toEqual({ health: 400, armor: 300 });
  });

  it('does not add +150 for damage heroes', () => {
    const tpl = {
      name: 'Infobox character',
      params: { role: '[[Damage]]', health: '200' },
    };
    expect(normalizeInfoboxHP(tpl)).toEqual({ health: 200 });
  });

  it('does not add +150 for support heroes', () => {
    const tpl = {
      name: 'Infobox character',
      params: { role: '[[Support]]', health: '200' },
    };
    expect(normalizeInfoboxHP(tpl)).toEqual({ health: 200 });
  });

  it('skips offset when tank has no health field', () => {
    const tpl = {
      name: 'Infobox character',
      params: { role: '[[Tank]]', armor: '150' },
    };
    expect(normalizeInfoboxHP(tpl)).toEqual({ armor: 150 });
  });
});

describe('normalizeSubRole', () => {
  it('returns undefined when missing', () => {
    expect(normalizeSubRole(null)).toBeUndefined();
    expect(normalizeSubRole({ name: 'x', params: {} })).toBeUndefined();
  });

  it('returns trimmed sub-role', () => {
    const tpl = { name: 'x', params: { 'sub-role': 'Flanker' } };
    expect(normalizeSubRole(tpl)).toBe('Flanker');
  });
});

describe('normalizeAbility', () => {
  it('returns null when ability_name missing', () => {
    expect(normalizeAbility({ name: 'Ability_details', params: {} })).toBeNull();
  });

  it('parses headshot tick as boolean true', () => {
    const result = normalizeAbility({
      name: 'Ability_details',
      params: { ability_name: 'Test', headshot: '✓' },
    });
    expect(result?.stats.headshot).toBe(true);
  });

  it('parses numeric ammo as number', () => {
    const result = normalizeAbility({
      name: 'Ability_details',
      params: { ability_name: 'Test', ammo: '8' },
    });
    expect(result?.stats.ammo).toBe(8);
  });

  it('keeps string when value has units', () => {
    const result = normalizeAbility({
      name: 'Ability_details',
      params: { ability_name: 'Test', cooldown: '10 seconds' },
    });
    expect(result?.stats.cooldown).toBe('10 seconds');
  });

  it('maps damage_falloff_range to falloff', () => {
    const result = normalizeAbility({
      name: 'Ability_details',
      params: { ability_name: 'Test', damage_falloff_range: '10 – 20 meters' },
    });
    expect(result?.stats.falloff).toBe('10 – 20 meters');
  });

  it('maps fire_rate to rate_of_fire', () => {
    const result = normalizeAbility({
      name: 'Ability_details',
      params: { ability_name: 'Test', fire_rate: '2 shots/s' },
    });
    expect(result?.stats.rate_of_fire).toBe('2 shots/s');
  });

  it('maps barrier_health to health', () => {
    const result = normalizeAbility({
      name: 'Ability_details',
      params: { ability_name: 'Experimental Barrier', barrier_health: '650' },
    });
    expect(result?.stats.health).toBe(650);
  });

  it('maps health on deployable abilities', () => {
    const result = normalizeAbility({
      name: 'Ability_details',
      params: { ability_name: 'Sentry Turret', health: '30' },
    });
    expect(result?.stats.health).toBe(30);
  });

  it('skips empty parameters', () => {
    const result = normalizeAbility({
      name: 'Ability_details',
      params: { ability_name: 'Test', cooldown: '', spread: '   ' },
    });
    expect(result?.stats.cooldown).toBeUndefined();
    expect(result?.stats.spread).toBeUndefined();
  });
});

describe('extractSections — section-based perk and ability extraction', () => {
  it('routes blocks under "=== Minor Perks ===" to minor regardless of ability_type field', () => {
    const wt = `
== Perks ==
=== Minor Perks ===
{{Ability details
| ability_name = Mislabeled Minor
| ability_type = Major Perk
| official_description = One.
}}
=== Major perks ===
{{Ability details
| ability_name = Real Major
| ability_type = Major Perk
| official_description = Two.
}}
`;
    const sec = extractSections(wt);
    expect(sec.minorPerks.map((p) => p.name)).toEqual(['Mislabeled Minor']);
    expect(sec.majorPerks.map((p) => p.name)).toEqual(['Real Major']);
  });

  it('skips blocks inside "==== Removed Perks ====" subsubsection', () => {
    const wt = `
== Perks ==
=== Major Perks ===
{{Ability details
| ability_name = Current
| ability_type = Major Perk
| official_description = Active.
}}
==== Removed Perks ====
{{Ability details
| ability_name = Old Major
| ability_type = Major Perk
| official_description = Retired.
}}
`;
    const sec = extractSections(wt);
    expect(sec.majorPerks.map((p) => p.name)).toEqual(['Current']);
  });

  it('skips removed=1 and "(old)" suffixed names', () => {
    const wt = `
== Perks ==
=== Minor Perks ===
{{Ability details
| ability_name = Active
| ability_type = Minor Perk
| official_description = ok.
}}
{{Ability details
| removed = 1
| ability_name = Removed Flagged
| ability_type = Minor Perk
| official_description = was.
}}
{{Ability details
| ability_name = Stale (old)
| ability_type = Minor Perk
| official_description = was.
}}
`;
    const sec = extractSections(wt);
    expect(sec.minorPerks.map((p) => p.name)).toEqual(['Active']);
  });

  it('extracts abilities under "== Abilities ==" with descriptions', () => {
    const wt = `
== Abilities ==
{{Ability details
| ability_name = Test Weapon
| ability_type = Weapon
| official_description = Shoots stuff.
}}
{{Ability details
| ability_name = Removed Mode
| removed = 1
| official_description = was.
}}
== Strategy ==
text
`;
    const sec = extractSections(wt);
    expect(sec.abilityBlocks).toHaveLength(1);
    expect(sec.abilityBlocks[0]).toMatchObject({ name: 'Test Weapon', description: 'Shoots stuff.' });
  });
});

describe('normalizeFandomHero on Reaper fixture', () => {
  const wt = loadFixtureWikitext('fandom-reaper.json');
  const hero = normalizeFandomHero(wt);

  it('captures Reaper sub_role', () => {
    expect(hero.sub_role).toBe('Flanker');
  });

  it('captures Reaper health', () => {
    expect(hero.stats.health).toBe(300);
  });

  it('emits abilities with names and descriptions', () => {
    expect(hero.abilities.length).toBeGreaterThan(0);
    const hellfire = hero.abilities.find((a) => a.name === 'Hellfire Shotguns');
    expect(hellfire).toBeDefined();
    expect(hellfire!.description).toContain('Short-range');
  });

  it('emits a slug derived from the ability name', () => {
    const hellfire = hero.abilities.find((a) => a.name === 'Hellfire Shotguns');
    expect(hellfire!.slug).toBe('hellfire-shotguns');
    const wraith = hero.abilities.find((a) => a.name === 'Wraith Form');
    expect(wraith!.slug).toBe('wraith-form');
  });

  it('emits slugs on perks', () => {
    for (const p of [...hero.perks.minor, ...hero.perks.major]) {
      expect(p.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(p.slug.length).toBeGreaterThan(0);
    }
  });

  it('captures Hellfire Shotguns combat stats on the ability entry', () => {
    const hellfire = hero.abilities.find((a) => a.name === 'Hellfire Shotguns');
    expect(hellfire).toBeDefined();
    expect(hellfire!.ammo).toBe(8);
    expect(hellfire!.pellets).toBe(20);
    expect(hellfire!.headshot).toBe(true);
    expect(hellfire!.spread).toBe('6 degrees');
    expect(hellfire!.falloff).toBe('10 – 20 meters');
    expect(hellfire!.rate_of_fire).toBe('2 shots/s');
    expect(hellfire!.reload).toBe('1.5 seconds animation');
  });

  it('captures Shadow Step cooldown', () => {
    const shadow = hero.abilities.find((a) => a.name === 'Shadow Step');
    expect(shadow).toBeDefined();
    expect(String(shadow!.cooldown ?? '')).toContain('10');
  });

  it('emits exactly 2 minor and 2 major perks for Reaper', () => {
    expect(hero.perks.minor).toHaveLength(2);
    expect(hero.perks.major).toHaveLength(2);
    const minorNames = hero.perks.minor.map((p) => p.name);
    const majorNames = hero.perks.major.map((p) => p.name);
    expect(minorNames).toContain('Soul Reaving');
    expect(minorNames).toContain('Lingering Wraith');
    expect(majorNames).toContain('Shadow Blink');
    expect(majorNames).toContain('Trigger Finger');
  });

  it('attaches non-empty perk descriptions', () => {
    for (const p of [...hero.perks.minor, ...hero.perks.major]) {
      expect(p.description.length).toBeGreaterThan(0);
    }
  });
});

describe('normalizeFandomHero on Soldier: 76 fixture', () => {
  const wt = loadFixtureWikitext('fandom-soldier-76.json');
  const hero = normalizeFandomHero(wt);

  it('captures Heavy Pulse Rifle stats on the ability entry', () => {
    const rifle = hero.abilities.find((a) => a.name === 'Heavy Pulse Rifle');
    expect(rifle).toBeDefined();
    expect(rifle!.ammo).toBe(30);
    expect(String(rifle!.falloff ?? '')).toContain('30');
  });
});

describe('normalizeFandomHero on Freja fixture (space-variant template)', () => {
  const wt = loadFixtureWikitext('fandom-freja.json');
  const hero = normalizeFandomHero(wt);

  it('still extracts abilities despite "Ability details" template variant', () => {
    expect(hero.abilities.length).toBeGreaterThan(0);
    const withStats = hero.abilities.filter((a) => Object.keys(a).length > 2);
    expect(withStats.length).toBeGreaterThan(0);
  });
});

describe('normalizeFandomHero on Emre fixture (same-name dual-mode rifle)', () => {
  const wt = loadFixtureWikitext('fandom-emre.json');
  const hero = normalizeFandomHero(wt);

  it('captures Hip Fire stats on the base Synthetic Burst Rifle entry', () => {
    const rifle = hero.abilities.find((a) => a.name === 'Synthetic Burst Rifle');
    expect(rifle).toBeDefined();
    expect(rifle!.ability_type).toBe('Weapon;;Hip Fire');
    expect(rifle!.ammo).toBe(36);
    expect(rifle!.pellets).toBe(3);
    expect(rifle!.falloff).toBe('25 - 40 meters');
    expect(rifle!.spread).toBe('0.45 degrees (max)');
  });

  it('nests Zoomed stats under modes with ability_type stripped', () => {
    const rifle = hero.abilities.find((a) => a.name === 'Synthetic Burst Rifle');
    const zoomed = rifle!.modes?.['Weapon;;Zoomed'];
    expect(zoomed).toBeDefined();
    expect(zoomed!.falloff).toBe('35 - 60 meters');
    expect(zoomed!.spread).toBe('0.05 degrees (max)');
    expect(zoomed).not.toHaveProperty('ability_type');
  });

  it('preserves single-mode Cyber Frag as flat entry', () => {
    const frag = hero.abilities.find((a) => a.name === 'Cyber Frag');
    expect(frag).toBeDefined();
    expect(frag!.cooldown).toBe('10 seconds');
    expect(frag!.modes).toBeUndefined();
  });
});
