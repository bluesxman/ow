import type { Ability, AbilityStat, AbilityStatMode, Hero, HeroStats, Perk } from '../types.js';
import { extractTopLevelTemplates, type ParsedTemplate } from './fandomWikitext.js';

const FIELD_MAP: Record<string, keyof AbilityStat> = {
  damage: 'damage',
  damage_falloff_range: 'falloff',
  falloff: 'falloff',
  fire_rate: 'rate_of_fire',
  rate_of_fire: 'rate_of_fire',
  ammo: 'ammo',
  reload_time: 'reload',
  reload: 'reload',
  spread: 'spread',
  pradius: 'projectile_radius',
  projectile_radius: 'projectile_radius',
  pspeed: 'projectile_speed',
  projectile_speed: 'projectile_speed',
  pellets: 'pellets',
  headshot: 'headshot',
  cooldown: 'cooldown',
  duration: 'duration',
  range: 'range',
  radius: 'radius',
  heal: 'healing',
  healing: 'healing',
  health: 'health',
  barrier_health: 'health',
  dps: 'dps',
  movement_speed: 'movement_speed',
  move_speed: 'movement_speed',
  ability_type: 'ability_type',
  key: 'key',
};

export interface FandomHeroFields {
  sub_role?: string;
  abilities: Ability[];
  perks: { minor: Perk[]; major: Perk[] };
  stats: HeroStats;
}

export function normalizeInfoboxHP(infobox: ParsedTemplate | null): Pick<HeroStats, 'health' | 'armor' | 'shields'> {
  const out: Pick<HeroStats, 'health' | 'armor' | 'shields'> = {};
  if (!infobox) return out;
  const health = parseNumber(infobox.params['health']);
  if (health !== undefined) out.health = health;
  const armor = parseNumber(infobox.params['armor']);
  if (armor !== undefined) out.armor = armor;
  const shield = parseNumber(infobox.params['shield'] ?? infobox.params['shields']);
  if (shield !== undefined) out.shields = shield;
  return out;
}

export function normalizeSubRole(infobox: ParsedTemplate | null): string | undefined {
  if (!infobox) return undefined;
  const sub = infobox.params['sub-role'] ?? infobox.params['sub_role'];
  if (!sub) return undefined;
  const cleaned = sub.trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

export function normalizeAbility(template: ParsedTemplate): { name: string; stats: AbilityStat } | null {
  const rawName = template.params['ability_name'] ?? template.params['name'];
  if (!rawName) return null;
  const name = rawName.trim();
  if (!name) return null;

  const stats: AbilityStat = {};
  for (const [key, value] of Object.entries(template.params)) {
    if (!value || !value.trim()) continue;
    const mapped = FIELD_MAP[key];
    if (!mapped) continue;
    if (mapped === 'headshot') {
      const v = value.trim();
      stats.headshot = v === '✓' || v.toLowerCase() === 'yes' || v.toLowerCase() === 'true';
      continue;
    }
    const trimmed = value.trim();
    const num = parseNumber(trimmed);
    (stats as Record<string, number | string | boolean | undefined>)[mapped] = num !== undefined ? num : trimmed;
  }

  return { name, stats };
}

// Locate the body of a level-2 section (==Heading==) and return [start, end).
// End is the next level-2 header or end-of-document. Returns null if not found.
function findLevel2SectionRange(wt: string, headingPattern: RegExp): [number, number] | null {
  const m = headingPattern.exec(wt);
  if (!m) return null;
  const start = m.index + m[0].length;
  const next2 = /^==[^=][^\n]*==\s*$/gm;
  next2.lastIndex = start;
  const next = next2.exec(wt);
  return [start, next ? next.index : wt.length];
}

// Within a section body, drop everything from the first level-4 header whose
// label starts with "Removed" onward — those subsubsections list retired
// abilities/perks that Fandom keeps for reference but we don't ship.
function stripRemovedLevel4(body: string): string {
  return body.replace(/\n====\s*Removed[^=\n]*====[\s\S]*$/m, '');
}

// Parse the level-3 sub-headers within a section body and return the body
// ranges (relative to the original wikitext offset). The "name" is the
// trimmed header text, lower-cased for matching by the caller.
function splitLevel3Sections(
  wt: string,
  sectionRange: [number, number],
): Array<{ name: string; bodyStart: number; bodyEnd: number }> {
  const re = /^===\s*([^=\n]+?)\s*===\s*$/gm;
  re.lastIndex = sectionRange[0];
  const headers: Array<{ name: string; start: number; bodyStart: number }> = [];
  let h: RegExpExecArray | null;
  while ((h = re.exec(wt)) !== null && h.index < sectionRange[1]) {
    headers.push({ name: h[1]!.trim(), start: h.index, bodyStart: h.index + h[0].length });
  }
  return headers.map((entry, i) => ({
    name: entry.name,
    bodyStart: entry.bodyStart,
    bodyEnd: i + 1 < headers.length ? headers[i + 1]!.start : sectionRange[1],
  }));
}

interface ParsedAbilityBlock {
  name: string;
  description: string;
  stats: AbilityStat;
}

// Parse Ability_details / Ability_card templates inside a wikitext slice and
// emit name + description + stats. Skips removed=1 and "(old)" suffixed names.
function parseAbilityBlocks(slice: string): ParsedAbilityBlock[] {
  const out: ParsedAbilityBlock[] = [];
  for (const tpl of extractTopLevelTemplates(slice)) {
    const tn = tpl.name.toLowerCase().replace(/[_\s]+/g, ' ').trim();
    if (tn !== 'ability details' && tn !== 'ability card') continue;
    const removed = (tpl.params['removed'] ?? '').trim();
    if (removed === '1') continue;
    const rawName = tpl.params['ability_name'] ?? tpl.params['name'];
    if (!rawName) continue;
    const name = rawName.trim();
    if (!name) continue;
    if (/\(\s*old\s*\)\s*$/i.test(name)) continue;
    const description = (tpl.params['official_description'] ?? tpl.params['description'] ?? '').trim();
    const parsed = normalizeAbility(tpl);
    out.push({
      name,
      description,
      stats: parsed?.stats ?? {},
    });
  }
  return out;
}

export interface ExtractedSections {
  abilityBlocks: ParsedAbilityBlock[];
  minorPerks: ParsedAbilityBlock[];
  majorPerks: ParsedAbilityBlock[];
}

// Parse the full wikitext into the four buckets we ship: abilities (under the
// "== Abilities ==" section), and minor/major perks (under "== Perks ==" with
// level-3 sub-headers). Removed-perk and removed-ability subsections are
// stripped before template extraction.
export function extractSections(wikitext: string): ExtractedSections {
  const abilityRange = findLevel2SectionRange(wikitext, /^==\s*Abilities\s*==\s*$/m);
  const perksRange = findLevel2SectionRange(wikitext, /^==\s*Perks\s*==\s*$/m);

  const abilityBlocks: ParsedAbilityBlock[] = [];
  if (abilityRange) {
    const slice = stripRemovedLevel4(wikitext.substring(abilityRange[0], abilityRange[1]));
    for (const block of parseAbilityBlocks(slice)) {
      // Defense in depth — perk templates stray into Abilities sections occasionally.
      const at = (block.stats.ability_type as string | undefined)?.toLowerCase() ?? '';
      if (/perk/.test(at)) continue;
      abilityBlocks.push(block);
    }
  }

  const minorPerks: ParsedAbilityBlock[] = [];
  const majorPerks: ParsedAbilityBlock[] = [];
  if (perksRange) {
    for (const sub of splitLevel3Sections(wikitext, perksRange)) {
      const slice = stripRemovedLevel4(wikitext.substring(sub.bodyStart, sub.bodyEnd));
      const blocks = parseAbilityBlocks(slice);
      if (/^minor\s+perks?$/i.test(sub.name)) minorPerks.push(...blocks);
      else if (/^major\s+perks?$/i.test(sub.name)) majorPerks.push(...blocks);
    }
  }

  return { abilityBlocks, minorPerks, majorPerks };
}

// Drop fields that don't carry information for the published Ability stats.
// `key` is a wiki-internal binding label; `ability_type` we keep because it
// classifies entries (Weapon / Ability / Passive Ability / Ultimate Ability).
function cleanStatsForPublish(stats: AbilityStat): AbilityStat {
  const { key: _key, ...rest } = stats;
  void _key;
  return rest;
}

export function normalizeFandomHero(wikitext: string): FandomHeroFields {
  const allTemplates = extractTopLevelTemplates(wikitext);
  let infobox: ParsedTemplate | null = null;
  for (const tpl of allTemplates) {
    const n = tpl.name.toLowerCase().replace(/[_\s]+/g, ' ').trim();
    if (n === 'infobox character' || n === 'infobox hero') {
      infobox = tpl;
      break;
    }
  }

  const hp = normalizeInfoboxHP(infobox);
  const subRole = normalizeSubRole(infobox);
  const sections = extractSections(wikitext);

  const abilityList: Ability[] = sections.abilityBlocks.map((b) => ({
    name: b.name,
    description: b.description || '(no description on Fandom)',
  }));

  // Fold same-named ability templates into a single base entry with `modes`
  // sub-records, so `stats.abilities` stays keyed uniquely. Pick the Hip Fire
  // / Primary Fire entry as base when present, else the first occurrence.
  const groups = new Map<string, ParsedAbilityBlock[]>();
  for (const b of sections.abilityBlocks) {
    const existing = groups.get(b.name);
    if (existing) existing.push(b);
    else groups.set(b.name, [b]);
  }

  const abilityStats: Record<string, AbilityStat> = {};
  for (const [name, group] of groups) {
    if (group.length === 1) {
      abilityStats[name] = cleanStatsForPublish(group[0]!.stats);
      continue;
    }
    const baseIdx = pickBaseIndex(group);
    const base = cleanStatsForPublish(group[baseIdx]!.stats);
    const modes: Record<string, AbilityStatMode> = {};
    for (let i = 0; i < group.length; i++) {
      if (i === baseIdx) continue;
      const stats = cleanStatsForPublish(group[i]!.stats);
      const modeKey = typeof stats.ability_type === 'string' && stats.ability_type.trim()
        ? stats.ability_type.trim()
        : 'Alt';
      const { ability_type: _at, modes: _m, ...rest } = stats;
      void _at;
      void _m;
      const submode = rest as AbilityStatMode;
      if (modes[modeKey] !== undefined) {
        console.warn(`duplicate sub-mode "${modeKey}" for ability "${name}" — overwriting`);
      }
      modes[modeKey] = submode;
    }
    base.modes = modes;
    abilityStats[name] = base;
  }

  const stats: HeroStats = { ...hp };
  if (Object.keys(abilityStats).length > 0) stats.abilities = abilityStats;

  const perks = {
    minor: sections.minorPerks.map((p) => ({ name: p.name, description: p.description })),
    major: sections.majorPerks.map((p) => ({ name: p.name, description: p.description })),
  };

  const result: FandomHeroFields = { abilities: abilityList, perks, stats };
  if (subRole) result.sub_role = subRole;
  return result;
}

function pickBaseIndex(group: Array<{ stats: AbilityStat }>): number {
  const hipFire = group.findIndex((g) => /hip\s*fire/i.test(String(g.stats.ability_type ?? '')));
  if (hipFire >= 0) return hipFire;
  const primary = group.findIndex((g) => /primary\s*fire/i.test(String(g.stats.ability_type ?? '')));
  if (primary >= 0) return primary;
  return 0;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

// Compose a full Hero from the roster entry (Blizzard) + Fandom-derived fields.
// The roster supplies slug, display name, role, optional sub_role and portrait;
// Fandom supplies abilities, perks, and stats.
export function buildHeroFromFandom(
  roster: { slug: string; name: string; role: 'tank' | 'damage' | 'support'; sub_role?: string; portrait_url?: string },
  fandom: FandomHeroFields,
): Hero {
  const hero: Hero = {
    slug: roster.slug,
    name: roster.name,
    role: roster.role,
    abilities: fandom.abilities,
    perks: fandom.perks,
    stats: fandom.stats,
  };
  const subRole = roster.sub_role ?? fandom.sub_role;
  if (subRole) hero.sub_role = subRole;
  if (roster.portrait_url) hero.portrait_url = roster.portrait_url;
  return hero;
}
