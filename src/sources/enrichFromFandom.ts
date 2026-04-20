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
// Two compounding patterns for scoped/ADS weapon modes:
//   1. Same base name with a parenthetical suffix ("Synthetic Burst Rifle" +
//      "Synthetic Burst Rifle (ADS)") — fold the suffixed one under base.modes[<suffix>].
//   2. Entirely different names for the scoped template ("The Viper" + "Take Aim (ADS)",
//      "Biotic Rifle" + "Zoom (ADS)") — anchor the orphan via its ability_type: if exactly
//      one kept weapon is labeled Hip Fire / Primary Fire and exactly one dropped orphan is
//      labeled ADS / Scoped / Zoomed, fold the orphan under that anchor.
//
// Ambiguity (zero or multiple anchors, zero or multiple orphans on the same hero) throws
// — scrape-level failure is preferable to silent data loss. The enrichment loop catches
// per-hero, so one bad hero doesn't abort the run.
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
  const dropped: Array<{ name: string; stats: import('../types.js').AbilityStat }> = [];

  for (const [name, stats] of Object.entries(fandomAbilities)) {
    if (current.has(name.toLowerCase())) {
      out[name] = stats;
      continue;
    }
    const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name);
    const suffix = m?.[2]?.trim();
    if (m && m[1] && suffix && !/^old$/i.test(suffix) && current.has(m[1].trim().toLowerCase())) {
      suffixed.push({ base: m[1].trim(), suffix, stats });
    } else {
      dropped.push({ name, stats });
    }
  }

  for (const { base, suffix, stats } of suffixed) {
    const baseKey = Object.keys(out).find((k) => k.toLowerCase() === base.toLowerCase());
    if (!baseKey) {
      dropped.push({ name: `${base} (${suffix})`, stats });
      continue;
    }
    foldModeInto(out[baseKey]!, baseKey, deriveModeKey(stats.ability_type, suffix), stats);
  }

  foldOrphanScopedModes(out, dropped, blizzardHero.slug);

  return out;
}

function foldModeInto(
  baseStats: import('../types.js').AbilityStat,
  baseKey: string,
  modeKey: string,
  sourceStats: import('../types.js').AbilityStat,
): void {
  const { ability_type: _at, modes: _m, ...rest } = sourceStats;
  void _at; void _m;
  const submode = rest as import('../types.js').AbilityStatMode;
  const existingModes = baseStats.modes ?? {};
  if (existingModes[modeKey] !== undefined) {
    throw new Error(`duplicate sub-mode "${modeKey}" for ability "${baseKey}"`);
  }
  baseStats.modes = { ...existingModes, [modeKey]: submode };
}

function deriveModeKey(abilityType: string | undefined, suffix: string): string {
  if (typeof abilityType === 'string') {
    const p = /\(([^)]+)\)/.exec(abilityType);
    if (p && p[1]) return p[1].trim();
    const semi = abilityType.split(/;;|::/).map((s) => s.trim()).filter(Boolean);
    if (semi.length >= 2) return semi[semi.length - 1]!;
  }
  return suffix;
}

// Match Fandom's ability_type labels. Fandom writes them in two flavors:
//   "Weapon;;Hip Fire" / "Weapon;;ADS" (semicolon-separated)
//   "Weapon (Hip Fire)" / "Weapon (ADS)" (parenthesized)
// Primary/Hip classify as the "anchor" mode (the default-fire weapon entry Blizzard lists);
// ADS/Scoped/Zoomed/Secondary-Fire classify as orphan alternate modes that need folding.
const PRIMARY_RE = /(hip\s*fire|primary\s*fire)/i;
const ALT_MODE_RE = /(ads|scoped|zoomed|secondary\s*fire|alt\w*\s*fire)/i;

function classifyAbilityType(abilityType: string | undefined): 'primary' | 'alt' | 'other' {
  if (typeof abilityType !== 'string') return 'other';
  if (ALT_MODE_RE.test(abilityType)) return 'alt';
  if (PRIMARY_RE.test(abilityType)) return 'primary';
  return 'other';
}

// Derive the mode key for an orphan by its ability_type label, falling back to a fixed
// default. E.g. "Weapon;;Secondary Fire" → "Secondary Fire"; "Weapon (ADS)" → "ADS".
function deriveOrphanModeKey(abilityType: string | undefined): string {
  if (typeof abilityType === 'string') {
    const p = /\(([^)]+)\)/.exec(abilityType);
    if (p && p[1]) return p[1].trim();
    const semi = abilityType.split(/;;|::/).map((s) => s.trim()).filter(Boolean);
    if (semi.length >= 2) return semi[semi.length - 1]!;
  }
  return 'Alt';
}

function foldOrphanScopedModes(
  out: Record<string, import('../types.js').AbilityStat>,
  dropped: Array<{ name: string; stats: import('../types.js').AbilityStat }>,
  slug: string,
): void {
  const altOrphans = dropped.filter((d) => classifyAbilityType(d.stats.ability_type) === 'alt');
  if (altOrphans.length === 0) return;

  const anchors = Object.entries(out).filter(
    ([, stats]) => classifyAbilityType(stats.ability_type) === 'primary',
  );

  if (anchors.length === 0) {
    // No Blizzard-matched primary weapon, but Fandom has a primary-fire orphan that can
    // serve as the base. This happens when Blizzard doesn't surface the hero's weapons as
    // separate abilities (e.g., Mauga's dual chainguns, attached to his passive).
    const primaryOrphans = dropped.filter(
      (d) => classifyAbilityType(d.stats.ability_type) === 'primary',
    );
    if (primaryOrphans.length === 1 && altOrphans.length === 1) {
      const primary = primaryOrphans[0]!;
      const alt = altOrphans[0]!;
      out[primary.name] = primary.stats;
      const modeKey = deriveOrphanModeKey(alt.stats.ability_type);
      foldModeInto(primary.stats, primary.name, modeKey, alt.stats);
      return;
    }
    throw new Error(
      `[${slug}] found ${altOrphans.length} alternate-mode Fandom template(s) with no Primary/Hip Fire anchor to fold into: ${altOrphans.map((o) => `"${o.name}"`).join(', ')}`,
    );
  }
  if (anchors.length > 1) {
    throw new Error(
      `[${slug}] found ${altOrphans.length} alternate-mode Fandom template(s) but ${anchors.length} Primary/Hip Fire anchors — cannot disambiguate: orphans=${altOrphans.map((o) => `"${o.name}"`).join(', ')}, anchors=${anchors.map(([n]) => `"${n}"`).join(', ')}`,
    );
  }
  if (altOrphans.length > 1) {
    throw new Error(
      `[${slug}] found ${altOrphans.length} alternate-mode Fandom template(s) for a single anchor — cannot disambiguate: ${altOrphans.map((o) => `"${o.name}"`).join(', ')}`,
    );
  }

  const [anchorKey, anchorStats] = anchors[0]!;
  const orphan = altOrphans[0]!;
  const modeKey = deriveOrphanModeKey(orphan.stats.ability_type);
  foldModeInto(anchorStats, anchorKey, modeKey, orphan.stats);
}
