import { describe, it, expect } from 'vitest';
import { buildAggregates } from '../publish.js';
import type { Hero, Metadata, RosterEntry } from '../types.js';

function meta(): Metadata {
  return {
    last_updated: '2026-04-20T00:00:00.000Z',
    patch_version: 'Test Patch',
    hero_count: 2,
    heroes_failed: [],
    fandom_failed: [],
    sources: [],
    schema_version: '2',
  };
}

function hero(slug: string, role: Hero['role']): Hero {
  return {
    slug,
    name: slug.charAt(0).toUpperCase() + slug.slice(1),
    role,
    abilities: [{ name: 'Cool', description: 'does stuff' }],
    perks: {
      minor: [
        { name: 'm1', description: '' },
        { name: 'm2', description: '' },
      ],
      major: [
        { name: 'M1', description: '' },
        { name: 'M2', description: '' },
      ],
    },
    stats: { health: 200, abilities: { Cool: { damage: 10 } } },
  };
}

describe('buildAggregates', () => {
  it('produces all six aggregate docs with shared metadata', () => {
    const heroes = { ana: hero('ana', 'support'), cassidy: hero('cassidy', 'damage') };
    const roster: RosterEntry[] = [
      { slug: 'cassidy', name: 'Cassidy', role: 'damage' },
      { slug: 'ana', name: 'Ana', role: 'support' },
    ];
    const m = meta();
    const agg = buildAggregates(heroes, roster, m);

    const indexDoc = agg.indexDoc as { metadata: Metadata; heroes: Array<{ slug: string }> };
    expect(indexDoc.metadata).toBe(m);
    expect(indexDoc.heroes.map((h) => h.slug)).toEqual(['ana', 'cassidy']);

    const heroesDoc = agg.heroesDoc as { heroes: RosterEntry[] };
    expect(heroesDoc.heroes.map((h) => h.slug)).toEqual(['ana', 'cassidy']);

    const statsDoc = agg.statsDoc as { heroes: Record<string, { stats: unknown }> };
    expect(statsDoc.heroes.cassidy?.stats).toEqual(heroes.cassidy.stats);

    const allDoc = agg.allDoc as { heroes: Record<string, Hero> };
    expect(allDoc.heroes.ana).toEqual(heroes.ana);
  });

  it('sorts hero keys deterministically regardless of input order', () => {
    const heroes = { zenyatta: hero('zenyatta', 'support'), ana: hero('ana', 'support') };
    const roster: RosterEntry[] = [
      { slug: 'zenyatta', name: 'Zenyatta', role: 'support' },
      { slug: 'ana', name: 'Ana', role: 'support' },
    ];
    const agg = buildAggregates(heroes, roster, meta());
    const statsDoc = agg.statsDoc as { heroes: Record<string, unknown> };
    expect(Object.keys(statsDoc.heroes)).toEqual(['ana', 'zenyatta']);
  });
});
