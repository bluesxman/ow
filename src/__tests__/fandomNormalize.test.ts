import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseWikitext } from '../sources/fandomWikitext.js';
import {
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

  it('skips empty parameters', () => {
    const result = normalizeAbility({
      name: 'Ability_details',
      params: { ability_name: 'Test', cooldown: '', spread: '   ' },
    });
    expect(result?.stats.cooldown).toBeUndefined();
    expect(result?.stats.spread).toBeUndefined();
  });
});

describe('normalizeFandomHero on Reaper fixture', () => {
  const wt = loadFixtureWikitext('fandom-reaper.json');
  const { infobox, abilities } = parseWikitext(wt);
  const hero = normalizeFandomHero(infobox, abilities);

  it('captures Reaper sub_role', () => {
    expect(hero.sub_role).toBe('Flanker');
  });

  it('captures Reaper health', () => {
    expect(hero.stats.health).toBe(300);
  });

  it('captures Hellfire Shotguns combat stats', () => {
    const hellfire = hero.stats.abilities?.['Hellfire Shotguns'];
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
    const shadow = hero.stats.abilities?.['Shadow Step'];
    expect(shadow).toBeDefined();
    expect(String(shadow!.cooldown ?? '')).toContain('10');
  });
});

describe('normalizeFandomHero on Soldier: 76 fixture', () => {
  const wt = loadFixtureWikitext('fandom-soldier-76.json');
  const { infobox, abilities } = parseWikitext(wt);
  const hero = normalizeFandomHero(infobox, abilities);

  it('captures Heavy Pulse Rifle stats', () => {
    const rifle = hero.stats.abilities?.['Heavy Pulse Rifle'];
    expect(rifle).toBeDefined();
    expect(rifle!.ammo).toBe(30);
    expect(String(rifle!.falloff ?? '')).toContain('30');
  });
});

describe('normalizeFandomHero on Freja fixture (space-variant template)', () => {
  const wt = loadFixtureWikitext('fandom-freja.json');
  const { infobox, abilities } = parseWikitext(wt);
  const hero = normalizeFandomHero(infobox, abilities);

  it('still extracts ability stats despite "Ability details" template variant', () => {
    expect(Object.keys(hero.stats.abilities ?? {}).length).toBeGreaterThan(0);
  });
});
