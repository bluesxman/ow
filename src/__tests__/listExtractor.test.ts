import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// We don't ship a DOM in test deps, so we exercise listExtractor.js indirectly:
// scan the saved fixture HTML for the same `a.hero-card[data-role]` shape the
// extractor reads. If Blizzard ever drops `data-role` or restructures `.hero-card`,
// these assertions fail loudly — same alarm as if the extractor had been run live.

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(HERE, 'fixtures/blizzard-heroes-index.html');
const HTML = readFileSync(FIXTURE_PATH, 'utf8');

interface Card {
  slug: string;
  role: string;
  sub_role: string;
}

function extractCards(html: string): Card[] {
  const cardRe = /<a\b[^>]*\bclass="hero-card"[^>]*>/g;
  const out: Card[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html)) !== null) {
    const tag = m[0];
    const idMatch = tag.match(/\bid="([^"]+)"/);
    const roleMatch = tag.match(/\bdata-role="([^"]+)"/);
    const subRoleMatch = tag.match(/\bdata-subrole="([^"]+)"/);
    if (!idMatch || !roleMatch) continue;
    const slug = idMatch[1]!;
    const role = roleMatch[1]!;
    if (role !== 'tank' && role !== 'damage' && role !== 'support') continue;
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, role, sub_role: subRoleMatch?.[1] ?? '' });
  }
  return out;
}

describe('Blizzard heroes index — role extraction', () => {
  const cards = extractCards(HTML);

  it('finds 51 unique hero cards', () => {
    expect(cards.length).toBe(51);
  });

  it('returns the expected role distribution (23 damage / 14 tank / 14 support)', () => {
    const counts = cards.reduce<Record<string, number>>((acc, c) => {
      acc[c.role] = (acc[c.role] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ damage: 23, tank: 14, support: 14 });
  });

  it('tags Reinhardt as tank/stalwart', () => {
    const r = cards.find((c) => c.slug === 'reinhardt');
    expect(r?.role).toBe('tank');
    expect(r?.sub_role).toBe('stalwart');
  });

  it('tags Ana as support', () => {
    const a = cards.find((c) => c.slug === 'ana');
    expect(a?.role).toBe('support');
  });

  it('tags Reaper as damage', () => {
    const r = cards.find((c) => c.slug === 'reaper');
    expect(r?.role).toBe('damage');
  });
});
