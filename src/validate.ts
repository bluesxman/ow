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

const StatValue = z.union([z.number(), z.string(), z.boolean()]);

// Mode entries (ADS / Zoomed / Secondary Fire / form variants) carry the same
// numeric fields as the base ability but never nest further.
const AbilityModeSchema = z.record(z.string(), StatValue.optional());

// Cross-ability effect: an ability that modifies another ability's behavior
// or stats (e.g. Sierra's Tracking Shot marks an enemy and Helix Rifle
// follow-up shots track the marker — Tracking Shot's "modifies" entry
// references Helix Rifle with the tracked-shot damage value).
//
// `target_ability` is the name of the affected ability on the same hero.
// Stat fields (damage, cooldown, etc.) carry the values that apply when this
// ability is in play, distinct from the affected ability's baseline stats.
const ModifiesEntrySchema = z.object({
  target_ability: z.string().min(1),
  description: z.string().optional(),
}).catchall(StatValue.optional());

const AbilitySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  modifies: z.array(ModifiesEntrySchema).optional(),
}).catchall(
  // Anything beyond name/description/modifies is either a numeric/string/boolean
  // stat or the `modes` record. Catchall keeps the schema permissive — Fandom
  // adds new template params over time and we don't want to break on them.
  z.union([StatValue, z.record(z.string(), AbilityModeSchema)]).optional(),
);

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
  }),
});

export type ValidatedHero = z.infer<typeof HeroSchema>;

// Patch-notes schema — validates the shape of data/patch-notes.json.
// Each change carries a {raw, interpreted} pair: the deterministic raw text
// from Blizzard plus AI-authored interpretation (mode, subject, metric, deltas).
// The interpreted layer is nullable when the AI couldn't make a confident call.

const SourceAttributionSchema = z.object({
  name: z.string(),
  url: z.string(),
  license: z.string(),
  license_url: z.string().optional(),
  fields: z.array(z.string()),
});

const MetadataSchema = z.object({
  last_updated: z.string(),
  patch_version: z.string(),
  hero_count: z.number(),
  heroes_failed: z.array(z.string()),
  fandom_failed: z.array(z.string()),
  sources: z.array(SourceAttributionSchema),
  schema_version: z.string(),
});

const PatchModeSchema = z.enum(['retail', 'stadium', 'mixed', 'unknown']);

const PatchSubjectKindSchema = z.enum([
  'hero_general',
  'ability',
  'perk',
  'role',
  'system',
  'map',
  'unknown',
]);

const PatchMetricSchema = z.enum([
  'damage',
  'cooldown',
  'duration',
  'range',
  'radius',
  'healing',
  'health',
  'shields',
  'armor',
  'ammo',
  'reload',
  'rate_of_fire',
  'movement_speed',
  'spread',
  'projectile_speed',
  'pellets',
  'cost',
  'ultimate_cost',
  'attack_speed',
  'energy',
  'other',
]);

const NumericOrString = z.union([z.number(), z.string()]);

const PatchChangeRawSchema = z.object({
  text: z.string().min(1),
});

const PatchChangeInterpretedSchema = z.object({
  mode: PatchModeSchema,
  subject_kind: PatchSubjectKindSchema,
  hero_slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).nullable(),
  subject_name: z.string().nullable(),
  metric: PatchMetricSchema.nullable(),
  metric_phrase: z.string().nullable(),
  from: NumericOrString.nullable(),
  to: NumericOrString.nullable(),
  delta: NumericOrString.nullable(),
  blizzard_commentary: z.array(z.string()),
  notes: z.string(),
});

const PatchChangeSchema = z.object({
  raw: PatchChangeRawSchema,
  interpreted: PatchChangeInterpretedSchema.nullable(),
});

const PatchSectionSchema = z.object({
  title: z.string().min(1),
  mode: PatchModeSchema,
  group_label: z.string().nullable(),
  changes: z.array(PatchChangeSchema),
});

const PatchSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(1),
  url: z.string().nullable(),
  sections: z.array(PatchSectionSchema),
});

export const PatchNotesDocSchema = z.object({
  metadata: MetadataSchema,
  patches: z.array(PatchSchema),
});

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
    role?: 'tank' | 'damage' | 'support';
    perks?: { minor: string[]; major: string[] };
    abilities?: Record<string, Record<string, string | number>>;
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

    if (expected.role && hero.role !== expected.role) {
      mismatches.push({
        slug: expected.slug,
        tier: 'role',
        expected: [expected.role],
        got: [hero.role],
      });
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

    if (expected.abilities) {
      for (const [abilityName, expectedFields] of Object.entries(expected.abilities)) {
        const actualAbility = hero.abilities.find((a) => a.name === abilityName);
        if (!actualAbility) {
          mismatches.push({
            slug: expected.slug,
            tier: `abilities.${abilityName}`,
            expected: [`<ability present with fields ${Object.keys(expectedFields).join(', ')}>`],
            got: ['<ability missing>'],
          });
          continue;
        }
        for (const [field, expectedVal] of Object.entries(expectedFields)) {
          const m = checkStatField(actualAbility as Record<string, unknown>, field, expectedVal);
          if (m) {
            mismatches.push({
              slug: expected.slug,
              tier: `abilities.${abilityName}.${field}`,
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
