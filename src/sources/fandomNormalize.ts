import type { AbilityStat, AbilityStatMode, HeroStats } from '../types.js';
import type { ParsedTemplate } from './fandomWikitext.js';

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
  dps: 'dps',
  movement_speed: 'movement_speed',
  move_speed: 'movement_speed',
  ability_type: 'ability_type',
  ability_details: undefined as unknown as keyof AbilityStat,
};

export interface FandomHeroFields {
  sub_role?: string;
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

export function normalizeFandomHero(
  infobox: ParsedTemplate | null,
  abilities: ParsedTemplate[],
): FandomHeroFields {
  const hp = normalizeInfoboxHP(infobox);
  const subRole = normalizeSubRole(infobox);

  const parsedInOrder: Array<{ name: string; stats: AbilityStat }> = [];
  for (const tpl of abilities) {
    const parsed = normalizeAbility(tpl);
    if (parsed) parsedInOrder.push(parsed);
  }

  const groups = new Map<string, Array<{ name: string; stats: AbilityStat }>>();
  for (const entry of parsedInOrder) {
    const existing = groups.get(entry.name);
    if (existing) existing.push(entry);
    else groups.set(entry.name, [entry]);
  }

  const abilityStats: Record<string, AbilityStat> = {};
  for (const [name, group] of groups) {
    if (group.length === 1) {
      abilityStats[name] = group[0]!.stats;
      continue;
    }
    const baseIdx = pickBaseIndex(group);
    const base = group[baseIdx]!.stats;
    const modes: Record<string, AbilityStatMode> = {};
    for (let i = 0; i < group.length; i++) {
      if (i === baseIdx) continue;
      const { stats } = group[i]!;
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

  const result: FandomHeroFields = { stats };
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
