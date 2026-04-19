import type { AbilityStat, HeroStats } from '../types.js';
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

  const abilityStats: Record<string, AbilityStat> = {};
  for (const tpl of abilities) {
    const parsed = normalizeAbility(tpl);
    if (!parsed) continue;
    abilityStats[parsed.name] = parsed.stats;
  }

  const stats: HeroStats = { ...hp };
  if (Object.keys(abilityStats).length > 0) stats.abilities = abilityStats;

  const result: FandomHeroFields = { stats };
  if (subRole) result.sub_role = subRole;
  return result;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}
