import { describe, it, expect } from 'vitest';
import { diffHeroes, isEmptyDiff, renderDiffMarkdown } from '../diff.js';
import type { Hero } from '../types.js';

function h(slug: string, overrides: Partial<Hero> = {}): Hero {
  return {
    slug,
    name: slug,
    role: 'damage',
    abilities: [{ slug: 'a', name: 'A', description: 'desc' }],
    perks: {
      minor: [
        { slug: 'm1', name: 'M1', description: 'x' },
        { slug: 'm2', name: 'M2', description: 'y' },
      ],
      major: [
        { slug: 'j1', name: 'J1', description: 'x' },
        { slug: 'j2', name: 'J2', description: 'y' },
      ],
    },
    stats: { health: 200 },
    ...overrides,
  };
}

describe('diffHeroes', () => {
  it('detects added heroes', () => {
    const d = diffHeroes({}, { reaper: h('reaper') });
    expect(d.added).toEqual(['reaper']);
    expect(isEmptyDiff(d)).toBe(false);
  });

  it('detects removed heroes', () => {
    const d = diffHeroes({ reaper: h('reaper') }, {});
    expect(d.removed).toEqual(['reaper']);
  });

  it('detects perk name change', () => {
    const prev = { reaper: h('reaper') };
    const next = {
      reaper: h('reaper', {
        perks: {
          minor: [
            { slug: 'm1', name: 'M1', description: 'x' },
            { slug: 'new', name: 'NEW', description: 'y' },
          ],
          major: [
            { slug: 'j1', name: 'J1', description: 'x' },
            { slug: 'j2', name: 'J2', description: 'y' },
          ],
        },
      }),
    };
    const d = diffHeroes(prev, next);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]?.slug).toBe('reaper');
  });

  it('detects stats change', () => {
    const prev = { reaper: h('reaper') };
    const next = { reaper: h('reaper', { stats: { health: 250 } }) };
    const d = diffHeroes(prev, next);
    expect(d.changed[0]?.changes.some((c) => c.includes('stats.health'))).toBe(true);
  });

  it('empty when identical', () => {
    const prev = { reaper: h('reaper') };
    const next = { reaper: h('reaper') };
    const d = diffHeroes(prev, next);
    expect(isEmptyDiff(d)).toBe(true);
  });

  it('renders markdown', () => {
    const d = diffHeroes({}, { reaper: h('reaper') });
    const md = renderDiffMarkdown(d, '2026-04-19', 'S2');
    expect(md).toContain('reaper');
    expect(md).toContain('S2');
  });
});
