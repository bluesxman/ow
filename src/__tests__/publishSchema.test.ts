import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { HeroSchema } from '../validate.js';

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
