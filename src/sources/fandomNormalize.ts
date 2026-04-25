import type { Ability, AbilityMode, Hero, HeroStats, Perk } from '../types.js';
import { extractTopLevelTemplates, type ParsedTemplate } from './fandomWikitext.js';

// Stat fields we lift from Fandom's Ability_details template params onto the
// Ability object. `key` is intentionally absent — that's a wiki-internal binding
// label, not a publishable stat — but is read separately during ingest where
// we still need it (currently nowhere; left out by omission).
type StatField =
  | 'damage' | 'cooldown' | 'range' | 'duration' | 'ammo'
  | 'rate_of_fire' | 'reload' | 'falloff' | 'spread'
  | 'projectile_radius' | 'projectile_speed' | 'pellets' | 'headshot'
  | 'radius' | 'healing' | 'health' | 'dps' | 'movement_speed'
  | 'ability_type';

const FIELD_MAP: Record<string, StatField> = {
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

// Extract the numeric/string stat fields from an Ability_details template body
// into a plain Record. Used both for the base ability object and for sub-mode
// entries (ADS / Zoomed / Secondary Fire). Empty values and unmapped keys are
// dropped.
function extractStatFields(template: ParsedTemplate): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const [key, value] of Object.entries(template.params)) {
    if (!value || !value.trim()) continue;
    const mapped = FIELD_MAP[key];
    if (!mapped) continue;
    if (mapped === 'headshot') {
      const v = value.trim();
      out.headshot = v === '✓' || v.toLowerCase() === 'yes' || v.toLowerCase() === 'true';
      continue;
    }
    const trimmed = value.trim();
    const num = parseNumber(trimmed);
    out[mapped] = num !== undefined ? num : trimmed;
  }
  return out;
}

// Direct field-mapping helper for tests. Wraps extractStatFields in the legacy
// shape `{ name, stats }` so unit tests can exercise the field map without
// going through the full section-aware pipeline.
export function normalizeAbility(template: ParsedTemplate): { name: string; stats: Record<string, number | string | boolean> } | null {
  const rawName = template.params['ability_name'] ?? template.params['name'];
  if (!rawName) return null;
  const name = rawName.trim();
  if (!name) return null;
  return { name, stats: extractStatFields(template) };
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
// trimmed header text; the caller decides how to match it.
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
  stats: Record<string, number | string | boolean>;
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
    out.push({ name, description, stats: extractStatFields(tpl) });
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

// Build the final Ability list. Same-named templates (the dual-mode rifles
// like "Synthetic Burst Rifle" + "Synthetic Burst Rifle (ADS)" — wait, those
// are differently named — only same-name pairs like Hip Fire + Zoomed) collapse
// into one entry with `modes`. Pick Hip Fire / Primary Fire as base when present.
function buildAbilities(blocks: ParsedAbilityBlock[]): Ability[] {
  const groups = new Map<string, ParsedAbilityBlock[]>();
  const order: string[] = [];
  for (const b of blocks) {
    const existing = groups.get(b.name);
    if (existing) {
      existing.push(b);
    } else {
      groups.set(b.name, [b]);
      order.push(b.name);
    }
  }

  const result: Ability[] = [];
  for (const name of order) {
    const group = groups.get(name)!;
    const baseIdx = pickBaseIndex(group);
    const baseBlock = group[baseIdx]!;
    const ability: Ability = {
      name,
      description: baseBlock.description || '(no description on Fandom)',
      ...baseBlock.stats,
    } as Ability;

    if (group.length > 1) {
      const modes: Record<string, AbilityMode> = {};
      for (let i = 0; i < group.length; i++) {
        if (i === baseIdx) continue;
        const sub = group[i]!.stats;
        const modeKey = typeof sub.ability_type === 'string' && sub.ability_type.trim()
          ? sub.ability_type.trim()
          : 'Alt';
        const { ability_type: _at, ...rest } = sub;
        void _at;
        if (modes[modeKey] !== undefined) {
          console.warn(`duplicate sub-mode "${modeKey}" for ability "${name}" — overwriting`);
        }
        modes[modeKey] = rest as AbilityMode;
      }
      ability.modes = modes;
    }
    result.push(ability);
  }
  return result;
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

  const abilities = buildAbilities(sections.abilityBlocks);

  const perks = {
    minor: sections.minorPerks.map((p) => ({
      name: p.name,
      description: p.description || '(no description on Fandom)',
    })),
    major: sections.majorPerks.map((p) => ({
      name: p.name,
      description: p.description || '(no description on Fandom)',
    })),
  };

  const result: FandomHeroFields = { abilities, perks, stats: { ...hp } };
  if (subRole) result.sub_role = subRole;
  return result;
}

function pickBaseIndex(group: Array<{ stats: Record<string, number | string | boolean> }>): number {
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
