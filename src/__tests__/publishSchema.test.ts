import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { HeroSchema, PatchNotesDocSchema } from '../validate.js';

// Regression: data/schema.json is derived from HeroSchema via z.toJSONSchema()
// at publish time. If a future zod upgrade changes the output shape (or someone
// removes the `role` enum from HeroSchema), external consumers downstream of the
// published JSON Schema would silently get a worse contract. Lock the surface.

describe('z.toJSONSchema(HeroSchema) — published schema contract', () => {
  const schema = z.toJSONSchema(HeroSchema, { target: 'draft-2020-12' }) as Record<string, unknown>;
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  const required = schema.required as string[];

  it('declares an object type with the expected required fields', () => {
    expect(schema.type).toBe('object');
    for (const f of ['slug', 'name', 'role', 'abilities', 'perks', 'stats']) {
      expect(required).toContain(f);
    }
  });

  it('declares role as an enum of tank|damage|support', () => {
    expect(properties.role).toEqual(expect.objectContaining({ type: 'string', enum: ['tank', 'damage', 'support'] }));
  });

  it('exposes perks.minor / perks.major as 2-item arrays', () => {
    const perks = properties.perks as Record<string, unknown>;
    const perkProps = perks.properties as Record<string, Record<string, unknown>>;
    expect(perkProps.minor).toEqual(expect.objectContaining({ type: 'array', minItems: 2, maxItems: 2 }));
    expect(perkProps.major).toEqual(expect.objectContaining({ type: 'array', minItems: 2, maxItems: 2 }));
  });

  it('exposes the slug pattern so external validators reject malformed slugs', () => {
    expect(properties.slug).toEqual(expect.objectContaining({ type: 'string', pattern: expect.stringContaining('a-z0-9') }));
  });
});

describe('z.toJSONSchema(PatchNotesDocSchema) — published patch-notes schema contract', () => {
  const schema = z.toJSONSchema(PatchNotesDocSchema, { target: 'draft-2020-12' }) as Record<string, unknown>;

  it('declares the top-level object with metadata + patches', () => {
    expect(schema.type).toBe('object');
    const required = schema.required as string[];
    expect(required).toContain('metadata');
    expect(required).toContain('patches');
  });

  const baseMetadata = {
    last_updated: '2026-04-25T00:00:00.000Z',
    patch_version: 'Test Patch',
    hero_count: 1,
    heroes_failed: [],
    fandom_failed: [],
    sources: [],
    schema_version: '5.0.0',
  };

  it('parses a minimal valid document with raw + null interpreted', () => {
    const minimal = {
      metadata: baseMetadata,
      patches: [
        {
          date: '2026-04-17',
          title: 'Overwatch Retail Patch Notes - April 17, 2026',
          url: null,
          sections: [
            {
              title: 'Damage',
              mode: 'retail',
              group_label: null,
              changes: [
                { raw: { text: 'Cassidy Peacekeeper damage reduced.' }, interpreted: null },
              ],
            },
          ],
        },
      ],
    };
    expect(PatchNotesDocSchema.safeParse(minimal).success).toBe(true);
  });

  it('parses a fully-interpreted change with mode/subject/metric/from/to', () => {
    const fullyInterpreted = {
      metadata: baseMetadata,
      patches: [
        {
          date: '2026-04-17',
          title: 'Test',
          url: null,
          sections: [
            {
              title: 'Damage',
              mode: 'retail',
              group_label: 'Cassidy',
              changes: [
                {
                  raw: { text: 'Damage per projectile reduced from 75 to 70.' },
                  interpreted: {
                    mode: 'retail',
                    subject_kind: 'ability',
                    hero_slug: 'cassidy',
                    subject_name: 'Peacekeeper',
                    metric: 'damage',
                    metric_phrase: 'damage per projectile',
                    from: 75,
                    to: 70,
                    delta: -5,
                    blizzard_commentary: [],
                    notes: '',
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    expect(PatchNotesDocSchema.safeParse(fullyInterpreted).success).toBe(true);
  });

  it('rejects an interpreted block with an invalid hero slug', () => {
    const bad = {
      metadata: baseMetadata,
      patches: [
        {
          date: '2026-04-17',
          title: 'Test',
          url: null,
          sections: [
            {
              title: 'Damage',
              mode: 'retail',
              group_label: null,
              changes: [
                {
                  raw: { text: 'x' },
                  interpreted: {
                    mode: 'retail',
                    subject_kind: 'ability',
                    hero_slug: 'BAD SLUG',
                    subject_name: 'Peacekeeper',
                    metric: 'damage',
                    metric_phrase: null,
                    from: null,
                    to: null,
                    delta: null,
                    blizzard_commentary: [],
                    notes: '',
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    expect(PatchNotesDocSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a malformed patch date', () => {
    const bad = {
      metadata: baseMetadata,
      patches: [{ date: 'April 17, 2026', title: 'Test', url: null, sections: [] }],
    };
    expect(PatchNotesDocSchema.safeParse(bad).success).toBe(false);
  });
});
