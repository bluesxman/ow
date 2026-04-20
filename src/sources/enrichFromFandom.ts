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
    const filtered = filterCurrentAbilityStats(fandomFields.stats.abilities, blizzardHero);
    if (Object.keys(filtered).length > 0) {
      merged.stats = {
        ...merged.stats,
        abilities: { ...(merged.stats.abilities ?? {}), ...filtered },
      };
    }
  }

  return merged;
}

// Fandom pages often retain {{Ability_details}} templates for removed abilities and perks
// (e.g., "Flashbang (old)", "Past Noon"). Only keep stats for names that match a current
// Blizzard-listed ability or perk. Match is case-insensitive — Blizzard and Fandom sometimes
// disagree on title-casing (e.g., "Even The Odds" vs "Even the Odds").
//
// Some weapons appear on Fandom under two templates with a parenthetical suffix (e.g.,
// "Synthetic Burst Rifle" + "Synthetic Burst Rifle (ADS)") while Blizzard lists only the
// base name. In that case, fold the suffixed template into base.modes[<suffix>] rather
// than dropping it.
export function filterCurrentAbilityStats(
  fandomAbilities: Record<string, import('../types.js').AbilityStat>,
  blizzardHero: Hero,
): Record<string, import('../types.js').AbilityStat> {
  const current = new Set<string>();
  for (const a of blizzardHero.abilities) current.add(a.name.toLowerCase());
  for (const p of blizzardHero.perks.minor) current.add(p.name.toLowerCase());
  for (const p of blizzardHero.perks.major) current.add(p.name.toLowerCase());

  const out: Record<string, import('../types.js').AbilityStat> = {};
  const suffixed: Array<{ base: string; suffix: string; stats: import('../types.js').AbilityStat }> = [];

  for (const [name, stats] of Object.entries(fandomAbilities)) {
    if (current.has(name.toLowerCase())) {
      out[name] = stats;
      continue;
    }
    const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name);
    if (m && m[1] && m[2] && current.has(m[1].trim().toLowerCase())) {
      suffixed.push({ base: m[1].trim(), suffix: m[2].trim(), stats });
    }
  }

  for (const { base, suffix, stats } of suffixed) {
    const baseKey = Object.keys(out).find((k) => k.toLowerCase() === base.toLowerCase());
    if (!baseKey) continue;
    const baseStats = out[baseKey]!;
    const modeKey = deriveModeKey(stats.ability_type, suffix);
    const { ability_type: _at, modes: _m, ...rest } = stats;
    void _at; void _m;
    const submode = rest as import('../types.js').AbilityStatMode;
    const existingModes = baseStats.modes ?? {};
    if (existingModes[modeKey] !== undefined) {
      console.warn(`duplicate sub-mode "${modeKey}" for ability "${baseKey}" — overwriting`);
    }
    baseStats.modes = { ...existingModes, [modeKey]: submode };
  }

  return out;
}

function deriveModeKey(abilityType: string | undefined, suffix: string): string {
  if (typeof abilityType === 'string') {
    const p = /\(([^)]+)\)/.exec(abilityType);
    if (p && p[1]) return p[1].trim();
  }
  return suffix;
}
