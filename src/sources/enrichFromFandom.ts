import type { Hero } from '../types.js';
import { FandomClient } from './FandomClient.js';
import { parseWikitext } from './fandomWikitext.js';
import { normalizeFandomHero } from './fandomNormalize.js';
import { slugToFandomTitle } from './slugToFandomTitle.js';

export interface EnrichmentResult {
  enriched: Record<string, Hero>;
  failed: Array<{ slug: string; reason: string }>;
}

export async function enrichAllFromFandom(
  heroes: Record<string, Hero>,
  client: FandomClient = new FandomClient(),
): Promise<EnrichmentResult> {
  const enriched: Record<string, Hero> = {};
  const failed: EnrichmentResult['failed'] = [];

  const entries = Object.entries(heroes);
  const total = entries.length;
  for (let i = 0; i < total; i++) {
    const [slug, hero] = entries[i]!;
    const started = Date.now();
    const prefix = `[${i + 1}/${total}] ${slug}`;
    try {
      const fandomFields = await enrichOne(client, slug);
      enriched[slug] = mergeFandomInto(hero, fandomFields);
      console.log(`${prefix} ok (${Date.now() - started}ms)`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`${prefix} fail (${Date.now() - started}ms): ${reason}`);
      failed.push({ slug, reason });
      enriched[slug] = hero;
    }
  }

  return { enriched, failed };
}

async function enrichOne(client: FandomClient, slug: string) {
  const title = slugToFandomTitle(slug);
  const wikitext = await client.getWikitext(title);
  const parsed = parseWikitext(wikitext);
  if (!parsed.infobox && parsed.abilities.length === 0) {
    throw new Error(`no infobox or ability templates found on "${title}"`);
  }
  return normalizeFandomHero(parsed.infobox, parsed.abilities);
}

function mergeFandomInto(
  blizzardHero: Hero,
  fandomFields: { sub_role?: string; stats: { health?: number; armor?: number; shields?: number; abilities?: Record<string, import('../types.js').AbilityStat> } },
): Hero {
  const merged: Hero = {
    ...blizzardHero,
    stats: { ...blizzardHero.stats },
  };

  if (fandomFields.sub_role && !merged.sub_role) {
    merged.sub_role = fandomFields.sub_role;
  }

  if (fandomFields.stats.health !== undefined) merged.stats.health = fandomFields.stats.health;
  if (fandomFields.stats.armor !== undefined) merged.stats.armor = fandomFields.stats.armor;
  if (fandomFields.stats.shields !== undefined) merged.stats.shields = fandomFields.stats.shields;

  if (fandomFields.stats.abilities && Object.keys(fandomFields.stats.abilities).length > 0) {
    merged.stats = {
      ...merged.stats,
      abilities: { ...(merged.stats.abilities ?? {}), ...fandomFields.stats.abilities },
    };
  }

  return merged;
}
