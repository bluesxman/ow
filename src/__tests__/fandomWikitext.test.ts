import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseWikitext, cleanValue, extractTopLevelTemplates } from '../sources/fandomWikitext.js';

const here = dirname(fileURLToPath(import.meta.url));

function loadFixtureWikitext(name: string): string {
  const raw = readFileSync(resolve(here, 'fixtures', name), 'utf8');
  const parsed = JSON.parse(raw) as { parse: { wikitext: { '*': string } } };
  return parsed.parse.wikitext['*'];
}

describe('cleanValue', () => {
  it('strips ref tags', () => {
    expect(cleanValue('hello<ref name="x">cite</ref> world')).toBe('hello world');
  });

  it('strips self-closing ref tags', () => {
    expect(cleanValue('hello<ref name="x" /> world')).toBe('hello world');
  });

  it('strips html comments', () => {
    expect(cleanValue('0.04 meters<!-- 0.04 global + 0 -->')).toBe('0.04 meters');
  });

  it('replaces br with separator', () => {
    expect(cleanValue('a<br>b')).toBe('a / b');
    expect(cleanValue('a<br/>b')).toBe('a / b');
  });

  it('keeps wikilink display text', () => {
    expect(cleanValue('[[Damage]]')).toBe('Damage');
    expect(cleanValue('[[Talon|Talon agent]]')).toBe('Talon agent');
  });

  it('reduces tt template to visible text', () => {
    expect(cleanValue('{{tt|2 shots/s|0.5 seconds recovery}}')).toBe('2 shots/s');
  });

  it('drops CalcDPS template', () => {
    expect(cleanValue('{{CalcDPS|d=115|t=0.5}} dps')).toBe('dps');
  });

  it('reduces vardefineecho to its value', () => {
    expect(cleanValue('{{#vardefineecho:reaping heal percent|25}}% of damage')).toBe('25% of damage');
  });

  it('drops bare #var lookups', () => {
    expect(cleanValue('{{#var:shotgun shot damage}} damage')).toBe('damage');
  });

  it('reduces al template to ability link text', () => {
    expect(cleanValue('{{al|Take Aim}}')).toBe('Take Aim');
  });

  it('strips bold and italic markers', () => {
    expect(cleanValue("'''bold''' and ''italic''")).toBe('bold and italic');
  });

  it('collapses whitespace', () => {
    expect(cleanValue('a   b\n\nc')).toBe('a b c');
  });
});

describe('extractTopLevelTemplates', () => {
  it('handles nested braces without splitting', () => {
    const tpls = extractTopLevelTemplates('{{Outer|x={{Inner|y=1}}|z=2}}');
    expect(tpls).toHaveLength(1);
    expect(tpls[0]!.name).toBe('Outer');
    expect(tpls[0]!.params['z']).toBe('2');
  });

  it('extracts multiple top-level templates separated by text', () => {
    const tpls = extractTopLevelTemplates('text {{A|x=1}} more {{B|y=2}} end');
    expect(tpls.map((t) => t.name)).toEqual(['A', 'B']);
  });
});

describe('parseWikitext on Reaper fixture (underscore variant)', () => {
  const wt = loadFixtureWikitext('fandom-reaper.json');
  const { infobox, abilities } = parseWikitext(wt);

  it('finds the infobox', () => {
    expect(infobox).not.toBeNull();
    expect(infobox!.params['health']).toBe('300');
    expect(infobox!.params['sub-role']).toBe('Flanker');
  });

  it('extracts at least 5 ability_details blocks', () => {
    expect(abilities.length).toBeGreaterThanOrEqual(5);
  });

  it('extracts Hellfire Shotguns with key combat fields', () => {
    const hellfire = abilities.find((a) => a.params['ability_name']?.trim() === 'Hellfire Shotguns');
    expect(hellfire).toBeDefined();
    expect(hellfire!.params['ammo']).toBe('8');
    expect(hellfire!.params['pellets']).toBe('20');
    expect(hellfire!.params['headshot']).toBe('✓');
    expect(hellfire!.params['spread']).toBe('6 degrees');
    expect(hellfire!.params['damage_falloff_range']).toBe('10 – 20 meters');
    expect(hellfire!.params['fire_rate']).toBe('2 shots/s');
    expect(hellfire!.params['reload_time']).toBe('1.5 seconds animation');
    expect(hellfire!.params['pradius']).toBe('0.04 meters');
  });

  it('strips template noise from damage field', () => {
    const hellfire = abilities.find((a) => a.params['ability_name']?.trim() === 'Hellfire Shotguns')!;
    expect(hellfire.params['damage']).toContain('5.75');
    expect(hellfire.params['damage']).toContain('1.725');
    expect(hellfire.params['damage']).toContain('per pellet');
    expect(hellfire.params['damage']).not.toContain('vardefineecho');
    expect(hellfire.params['damage']).not.toContain('<br>');
  });
});

describe('parseWikitext on Freja fixture (space variant)', () => {
  const wt = loadFixtureWikitext('fandom-freja.json');
  const { infobox, abilities } = parseWikitext(wt);

  it('finds the infobox', () => {
    expect(infobox).not.toBeNull();
  });

  it('extracts ability blocks despite space (not underscore) in template name', () => {
    expect(abilities.length).toBeGreaterThanOrEqual(5);
    const names = abilities.map((a) => a.params['ability_name']?.trim()).filter(Boolean);
    expect(names).toContain('Bounty Hunting');
  });
});

describe('parseWikitext on Soldier: 76 fixture', () => {
  const wt = loadFixtureWikitext('fandom-soldier-76.json');
  const { abilities } = parseWikitext(wt);

  it('extracts Heavy Pulse Rifle', () => {
    const rifle = abilities.find((a) => a.params['ability_name']?.trim() === 'Heavy Pulse Rifle');
    expect(rifle).toBeDefined();
    expect(rifle!.params['ammo']).toBe('30');
    expect(rifle!.params['damage_falloff_range']).toBe('30 - 50 meters');
    expect(rifle!.params['headshot']).toBe('✓');
  });
});
