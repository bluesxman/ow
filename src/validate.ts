import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { Hero } from './types.js';
import { normalizeForCompare } from './normalize.js';

const PerkSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

const AbilitySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

const StatValue = z.union([z.number(), z.string(), z.boolean()]);

const AbilityStatSchema = z.record(z.string(), StatValue.optional());

export const HeroSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1),
  role: z.enum(['tank', 'damage', 'support']),
  sub_role: z.string().optional(),
  portrait_url: z.string().url().optional(),
  abilities: z.array(AbilitySchema).min(1),
  perks: z.object({
    minor: z.array(PerkSchema).length(2),
    major: z.array(PerkSchema).length(2),
  }),
  stats: z.object({
    health: z.number().optional(),
    armor: z.number().optional(),
    shields: z.number().optional(),
    abilities: z.record(z.string(), AbilityStatSchema).optional(),
  }),
});

export type ValidatedHero = z.infer<typeof HeroSchema>;

export function validateHero(hero: unknown): { ok: true; value: Hero } | { ok: false; error: string } {
  const result = HeroSchema.safeParse(hero);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }
  return { ok: true, value: result.data as Hero };
}

interface ValidationFixture {
  heroes: Array<{
    slug: string;
    perks?: { minor: string[]; major: string[] };
    stats?: {
      abilities?: Record<string, Record<string, string | number>>;
    };
  }>;
}

async function loadFixture(): Promise<ValidationFixture> {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturePath = resolve(here, '__tests__/fixtures/validation.json');
  const raw = await readFile(fixturePath, 'utf8');
  return JSON.parse(raw) as ValidationFixture;
}

export interface FixtureCheckResult {
  ok: boolean;
  mismatches: Array<{
    slug: string;
    tier: string;
    expected: string[];
    got: string[];
  }>;
}

export async function checkAgainstFixture(heroes: Record<string, Hero>): Promise<FixtureCheckResult> {
  const fixture = await loadFixture();
  const mismatches: FixtureCheckResult['mismatches'] = [];

  for (const expected of fixture.heroes) {
    const hero = heroes[expected.slug];
    if (!hero) {
      mismatches.push({
        slug: expected.slug,
        tier: 'hero missing',
        expected: ['<hero present>'],
        got: [],
      });
      continue;
    }

    if (expected.perks) {
      for (const tier of ['minor', 'major'] as const) {
        const expectedSet = new Set(expected.perks[tier].map(normalizeForCompare));
        const gotNames = hero.perks[tier].map((p) => p.name);
        const gotSet = new Set(gotNames.map(normalizeForCompare));
        const allMatched = [...expectedSet].every((n) => gotSet.has(n));
        if (!allMatched || expectedSet.size !== gotSet.size) {
          mismatches.push({
            slug: expected.slug,
            tier,
            expected: expected.perks[tier],
            got: gotNames,
          });
        }
      }
    }

    if (expected.stats?.abilities) {
      for (const [abilityName, expectedFields] of Object.entries(expected.stats.abilities)) {
        const actualAbility = hero.stats.abilities?.[abilityName];
        if (!actualAbility) {
          mismatches.push({
            slug: expected.slug,
            tier: `stats.${abilityName}`,
            expected: [`<ability present with fields ${Object.keys(expectedFields).join(', ')}>`],
            got: ['<ability missing>'],
          });
          continue;
        }
        for (const [field, expectedVal] of Object.entries(expectedFields)) {
          const m = checkStatField(actualAbility, field, expectedVal);
          if (m) {
            mismatches.push({
              slug: expected.slug,
              tier: `stats.${abilityName}.${field}`,
              expected: [String(expectedVal)],
              got: [m.actual],
            });
          }
        }
      }
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

function checkStatField(
  ability: Record<string, unknown>,
  field: string,
  expected: string | number,
): { actual: string } | null {
  if (field.endsWith('_contains')) {
    const realField = field.slice(0, -'_contains'.length);
    const raw = ability[realField];
    if (raw === undefined || raw === null) return { actual: '<undefined>' };
    const s = String(raw).toLowerCase();
    const needle = String(expected).toLowerCase();
    if (!s.includes(needle)) return { actual: String(raw) };
    return null;
  }
  const raw = ability[field];
  if (raw === undefined || raw === null) return { actual: '<undefined>' };
  const a = normalizeForCompare(String(raw));
  const e = normalizeForCompare(String(expected));
  if (a !== e) return { actual: String(raw) };
  return null;
}
