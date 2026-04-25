import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseWikitext, type ParsedTemplate } from '../sources/fandomWikitext.js';
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

describe('normalizeFandomHero merges same-named templates into modes', () => {
  it('promotes Hip Fire entry to base and nests Zoomed under modes', () => {
    const templates: ParsedTemplate[] = [
      {
        name: 'Ability_details',
        params: {
          ability_name: 'Synthetic Burst Rifle',
          ability_type: 'Weapon;;Hip Fire',
          damage_falloff_range: '25 - 40 meters',
          spread: '0.45 degrees',
          ammo: '36',
        },
      },
      {
        name: 'Ability_details',
        params: {
          ability_name: 'Synthetic Burst Rifle',
          ability_type: 'Weapon;;Zoomed',
          damage_falloff_range: '35 - 60 meters',
          spread: '0.05 degrees',
        },
      },
    ];
    const hero = normalizeFandomHero(null, templates);
    const rifle = hero.stats.abilities?.['Synthetic Burst Rifle'];
    expect(rifle).toBeDefined();
    expect(rifle!.ability_type).toBe('Weapon;;Hip Fire');
    expect(rifle!.falloff).toBe('25 - 40 meters');
    expect(rifle!.spread).toBe('0.45 degrees');
    expect(rifle!.ammo).toBe(36);
    const zoomed = rifle!.modes?.['Weapon;;Zoomed'];
    expect(zoomed).toBeDefined();
    expect(zoomed!.falloff).toBe('35 - 60 meters');
    expect(zoomed!.spread).toBe('0.05 degrees');
    expect(zoomed).not.toHaveProperty('ability_type');
  });

  it('falls back to primary fire when no hip fire entry is present', () => {
    const templates: ParsedTemplate[] = [
      {
        name: 'Ability_details',
        params: {
          ability_name: 'Dual Mode',
          ability_type: 'Weapon;;Secondary Fire',
          damage: '50',
        },
      },
      {
        name: 'Ability_details',
        params: {
          ability_name: 'Dual Mode',
          ability_type: 'Weapon;;Primary Fire',
          damage: '75',
        },
      },
    ];
    const hero = normalizeFandomHero(null, templates);
    const entry = hero.stats.abilities?.['Dual Mode'];
    expect(entry?.ability_type).toBe('Weapon;;Primary Fire');
    expect(entry?.damage).toBe(75);
    expect(entry?.modes?.['Weapon;;Secondary Fire']?.damage).toBe(50);
  });

  it('leaves single-mode abilities flat with no modes field', () => {
    const templates: ParsedTemplate[] = [
      {
        name: 'Ability_details',
        params: {
          ability_name: 'Solo Ability',
          ability_type: 'Ability',
          cooldown: '6 seconds',
        },
      },
    ];
    const hero = normalizeFandomHero(null, templates);
    const entry = hero.stats.abilities?.['Solo Ability'];
    expect(entry).toBeDefined();
    expect(entry!.modes).toBeUndefined();
  });
});

describe('normalizeFandomHero on Emre fixture (same-name dual-mode rifle)', () => {
  const wt = loadFixtureWikitext('fandom-emre.json');
  const { infobox, abilities } = parseWikitext(wt);
  const hero = normalizeFandomHero(infobox, abilities);

  it('captures Hip Fire stats on the base Synthetic Burst Rifle entry', () => {
    const rifle = hero.stats.abilities?.['Synthetic Burst Rifle'];
    expect(rifle).toBeDefined();
    expect(rifle!.ability_type).toBe('Weapon;;Hip Fire');
    expect(rifle!.ammo).toBe(36);
    expect(rifle!.pellets).toBe(3);
    expect(rifle!.falloff).toBe('25 - 40 meters');
    expect(rifle!.spread).toBe('0.45 degrees (max)');
  });

  it('nests Zoomed stats under modes with ability_type stripped', () => {
    const rifle = hero.stats.abilities?.['Synthetic Burst Rifle'];
    const zoomed = rifle!.modes?.['Weapon;;Zoomed'];
    expect(zoomed).toBeDefined();
    expect(zoomed!.falloff).toBe('35 - 60 meters');
    expect(zoomed!.spread).toBe('0.05 degrees (max)');
    expect(zoomed).not.toHaveProperty('ability_type');
  });

  it('preserves single-mode Cyber Frag as flat entry', () => {
    const frag = hero.stats.abilities?.['Cyber Frag'];
    expect(frag).toBeDefined();
    expect(frag!.cooldown).toBe('10 seconds');
    expect(frag!.modes).toBeUndefined();
  });
});
