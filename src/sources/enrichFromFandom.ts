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
  const currentExact = new Set<string>();
  for (const a of blizzardHero.abilities) currentExact.add(a.name.toLowerCase());
  for (const p of blizzardHero.perks.minor) currentExact.add(p.name.toLowerCase());
  for (const p of blizzardHero.perks.major) currentExact.add(p.name.toLowerCase());

  const parenIndex = new Map<string, string[]>();
  const indexParen = (full: string): void => {
    const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(full);
    if (!m || !m[1]) return;
    const stem = m[1].trim().toLowerCase();
    if (!stem) return;
    const existing = parenIndex.get(stem);
    if (existing) existing.push(full);
    else parenIndex.set(stem, [full]);
  };
  for (const a of blizzardHero.abilities) indexParen(a.name);
  for (const p of blizzardHero.perks.minor) indexParen(p.name);
  for (const p of blizzardHero.perks.major) indexParen(p.name);

  const out: Record<string, import('../types.js').AbilityStat> = {};
  const suffixed: Array<{ base: string; suffix: string; stats: import('../types.js').AbilityStat }> = [];
  const dropped: Array<{ name: string; stats: import('../types.js').AbilityStat }> = [];

  for (const [name, stats] of Object.entries(fandomAbilities)) {
    const lower = name.toLowerCase();
    if (currentExact.has(lower)) {
      out[name] = stats;
      continue;
    }
    // Reverse-parenthetical match: Fandom "X" → Blizzard "X (suffix)".
    // Only fires when Fandom name has no parens itself (otherwise the suffixed-twin pass handles it).
    if (!/[()]/.test(name)) {
      const parenCandidates = parenIndex.get(lower);
      if (parenCandidates && parenCandidates.length === 1) {
        out[parenCandidates[0]!] = stats;
        continue;
      }
      if (parenCandidates && parenCandidates.length > 1) {
        throw new Error(
          `[${blizzardHero.slug}] Fandom ability "${name}" matches multiple Blizzard parenthetical abilities: ${parenCandidates.map((c) => `"${c}"`).join(', ')} — cannot disambiguate`,
        );
      }
    }
    const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name);
    const suffix = m?.[2]?.trim();
    if (m && m[1] && suffix && !/^old$/i.test(suffix) && currentExact.has(m[1].trim().toLowerCase())) {
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
  foldKeyBasedSecondaryOrphans(out, dropped, blizzardHero);

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
      removeFromDropped(dropped, primary);
      removeFromDropped(dropped, alt);
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
  removeFromDropped(dropped, orphan);
}

function removeFromDropped(
  dropped: Array<{ name: string; stats: import('../types.js').AbilityStat }>,
  item: { name: string; stats: import('../types.js').AbilityStat },
): void {
  const idx = dropped.indexOf(item);
  if (idx >= 0) dropped.splice(idx, 1);
}

// Secondary-fire abilities that Blizzard doesn't surface as separate ability entries
// (e.g., Reaper's Dire Triggers — Hellfire Shotguns' RMB; Junker Queen's Jagged Blade —
// Scattergun's throw-knife). Fandom encodes the binding via `key = "secondary fire"`
// rather than via a weapon-mode `ability_type` label, so the earlier alt-mode pass
// doesn't catch them.
//
// Parent selection:
//   1. Prefer the Blizzard ability (by exact-name match) whose description textually
//      mentions the orphan name. Disambiguates Junker Queen's Jagged Blade → Scattergun
//      via the Willy-Willy perk's description.
//   2. Else if exactly one kept ability is classifiable as a primary weapon, use it.
//      Handles Reaper's Dire Triggers → Hellfire Shotguns (the lone weapon).
//   3. Else throw — safer to surface a data gap than silently misplace the orphan.
//      Covers Ramattra's Block: multiple Blizzard-form weapons, no description mention.
const SECONDARY_KEY_RE = /secondary\s*fire|alt\w*\s*fire/i;

function foldKeyBasedSecondaryOrphans(
  out: Record<string, import('../types.js').AbilityStat>,
  dropped: Array<{ name: string; stats: import('../types.js').AbilityStat }>,
  blizzardHero: Hero,
): void {
  const orphans = dropped.filter(
    (d) =>
      typeof d.stats.key === 'string' &&
      SECONDARY_KEY_RE.test(d.stats.key) &&
      // Skip "(old)" templates Fandom retains for historical reference — they're
      // intentional silent drops matching the existing name-match pass behavior.
      !/\(\s*old\s*\)\s*$/i.test(d.name),
  );
  if (orphans.length === 0) return;

  for (const orphan of orphans) {
    const parentKey = findSecondaryOrphanParent(orphan.name, out, blizzardHero);
    if (!parentKey) {
      throw new Error(
        `[${blizzardHero.slug}] Fandom template "${orphan.name}" has key="${orphan.stats.key}" but no parent ability can be identified — orphan cannot be safely placed`,
      );
    }
    foldModeInto(out[parentKey]!, parentKey, 'Secondary Fire', orphan.stats);
    const idx = dropped.indexOf(orphan);
    if (idx >= 0) dropped.splice(idx, 1);
  }
}

function findSecondaryOrphanParent(
  orphanName: string,
  out: Record<string, import('../types.js').AbilityStat>,
  blizzardHero: Hero,
): string | null {
  // 1. Description-mention rule: pick the Blizzard ability whose description mentions
  //    the orphan name. Perk descriptions also count (they frequently reference the
  //    weapon the orphan belongs to).
  const wordRe = new RegExp(`\\b${orphanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  const mentioningAbilities = blizzardHero.abilities.filter((a) => wordRe.test(a.description));
  if (mentioningAbilities.length === 1) {
    const key = Object.keys(out).find((k) => k.toLowerCase() === mentioningAbilities[0]!.name.toLowerCase());
    if (key) return key;
  }
  const mentioningPerks = [...blizzardHero.perks.minor, ...blizzardHero.perks.major].filter(
    (p) => wordRe.test(p.description),
  );
  if (mentioningPerks.length === 1) {
    // Perk mentions the orphan; find which Blizzard ability the perk modifies by
    // scanning the perk's description for any kept-weapon name.
    for (const abKey of Object.keys(out)) {
      const re = new RegExp(`\\b${abKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(mentioningPerks[0]!.description)) return abKey;
    }
  }

  // 2. Single-weapon rule: exactly one kept ability has a weapon ability_type.
  //    "Weapon", "Weapon;;Primary Fire", "Weapon;;Hip Fire" all qualify.
  //    Skipped when the hero has parenthetical form-variant abilities (e.g. Ramattra's
  //    "Void Accelerator (Omnic Form)" / "Pummel (Nemesis Form)") — the single-weapon
  //    count is misleading because only one form's weapon shows, but the orphan may
  //    belong to the other form.
  const hasFormSplit = blizzardHero.abilities.some((a) => /\([^)]*\b(form|mode|stance)\b[^)]*\)/i.test(a.name));
  if (!hasFormSplit) {
    const weapons = Object.entries(out).filter(
      ([, s]) => typeof s.ability_type === 'string' && /\bweapon\b/i.test(s.ability_type),
    );
    if (weapons.length === 1) return weapons[0]![0];
  }

  return null;
}
