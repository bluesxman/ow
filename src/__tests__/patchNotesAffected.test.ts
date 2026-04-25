import { describe, it, expect } from 'vitest';
// @ts-expect-error — mjs script, no type declarations
import { parsePatchMarkdown, buildAffected, nameToSlug } from '../../.claude/skills/process-patch-notes/scripts/list-affected-heroes.mjs';
import type { Hero } from '../types.js';

function cassidy(): Hero {
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
    stats: {
      health: 225,
      abilities: {
        Peacekeeper: { damage: 75 },
        'Combat Roll': { cooldown: '6 seconds' },
        Deadeye: { cooldown: '120 seconds' },
      },
    },
  };
}

const SAMPLE_MD = `# Patch Notes — window: 2026-03-01 to 2026-04-17

## Overwatch Retail Patch Notes - April 17, 2026

### Damage

#### Cassidy
- **Peacekeeper**
  - Damage reduced from 75 to 70.
- **Combat Roll**
  - Cooldown increased from 6 to 8 seconds.
- Cassidy's health increased from 225 to 250.

#### PTR-Only Hero
- **Some Ability**
  - New thing.

### General Updates

#### Mystery Heroes Updates
- Map rotation changed.
`;

describe('parsePatchMarkdown', () => {
  it('extracts heroes, abilities, and hero-level bullets', () => {
    const parsed = parsePatchMarkdown(SAMPLE_MD);
    const cass = parsed.get('Cassidy');
    expect(cass).toBeDefined();
    expect([...cass.abilities]).toEqual(['Peacekeeper', 'Combat Roll']);
    expect(cass.heroLevel).toEqual(["Cassidy's health increased from 225 to 250."]);
  });
});

describe('buildAffected', () => {
  it('matches hero names to slugs and known abilities', () => {
    const parsed = parsePatchMarkdown(SAMPLE_MD);
    const report = buildAffected(parsed, { cassidy: cassidy() });
    expect(report.affected).toHaveLength(1);
    expect(report.affected[0]).toMatchObject({
      slug: 'cassidy',
      name: 'Cassidy',
      abilities: ['Peacekeeper', 'Combat Roll'],
      skipped_abilities: [],
    });
    expect(report.affected[0].hero_level_bullets).toEqual([
      "Cassidy's health increased from 225 to 250.",
    ]);
  });

  it('reports heroes with no data/heroes/ entry as unmatched', () => {
    const parsed = parsePatchMarkdown(SAMPLE_MD);
    const report = buildAffected(parsed, { cassidy: cassidy() });
    const slugs = report.unmatched.map((u: { hero: string }) => u.hero);
    expect(slugs).toContain('PTR-Only Hero');
    expect(slugs).toContain('Mystery Heroes Updates');
  });

  it('puts abilities not in stats.abilities into skipped_abilities', () => {
    const parsed = parsePatchMarkdown(`
## Patch Notes

### Damage

#### Cassidy
- **Deadeye**
  - duration increased.
- **Flashbang (old)**
  - this ability was removed.
`);
    const report = buildAffected(parsed, { cassidy: cassidy() });
    expect(report.affected[0].abilities).toEqual(['Deadeye']);
    expect(report.affected[0].skipped_abilities).toEqual(['Flashbang (old)']);
  });

  it('matches perk mentions via "X – Major Perk" suffix', () => {
    const parsed = parsePatchMarkdown(`
## Patch Notes

### Damage

#### Cassidy
- **Silver Bullet – Major Perk**
  - Bleed duration tweaked.
`);
    const report = buildAffected(parsed, { cassidy: cassidy() });
    expect(report.affected[0].abilities).toContain('Silver Bullet');
  });

  it('matches ability names wrapped in [brackets]', () => {
    const parsed = parsePatchMarkdown(`
## Patch Notes

### Damage

#### Cassidy
- **[Peacekeeper]**
  - Damage tweaked.
`);
    const report = buildAffected(parsed, { cassidy: cassidy() });
    expect(report.affected[0].abilities).toContain('Peacekeeper');
  });
});

describe('nameToSlug', () => {
  it('handles overrides and diacritics', () => {
    expect(nameToSlug('Soldier: 76')).toBe('soldier-76');
    expect(nameToSlug('Lúcio')).toBe('lucio');
    expect(nameToSlug('D.Va')).toBe('dva');
    expect(nameToSlug('Wrecking Ball')).toBe('wrecking-ball');
  });
});
