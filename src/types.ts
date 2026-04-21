export type Role = 'tank' | 'damage' | 'support';

export interface Perk {
  name: string;
  description: string;
}

export interface Ability {
  name: string;
  description: string;
}

export interface AbilityStatMode {
  damage?: number | string;
  cooldown?: number | string;
  range?: number | string;
  duration?: number | string;
  ammo?: number | string;
  rate_of_fire?: number | string;
  reload?: number | string;
  falloff?: number | string;
  spread?: number | string;
  projectile_radius?: number | string;
  projectile_speed?: number | string;
  pellets?: number | string;
  headshot?: boolean | string;
  radius?: number | string;
  healing?: number | string;
  dps?: number | string;
  movement_speed?: number | string;
  ability_type?: string;
  key?: string;
  [key: string]: number | string | boolean | undefined;
}

export interface AbilityStat {
  damage?: number | string;
  cooldown?: number | string;
  range?: number | string;
  duration?: number | string;
  ammo?: number | string;
  rate_of_fire?: number | string;
  reload?: number | string;
  falloff?: number | string;
  spread?: number | string;
  projectile_radius?: number | string;
  projectile_speed?: number | string;
  pellets?: number | string;
  headshot?: boolean | string;
  radius?: number | string;
  healing?: number | string;
  dps?: number | string;
  movement_speed?: number | string;
  ability_type?: string;
  key?: string;
  modes?: Record<string, AbilityStatMode>;
  [key: string]: number | string | boolean | Record<string, AbilityStatMode> | undefined;
}

export interface HeroStats {
  health?: number;
  armor?: number;
  shields?: number;
  abilities?: Record<string, AbilityStat>;
}

export interface Hero {
  slug: string;
  name: string;
  role: Role;
  sub_role?: string;
  portrait_url?: string;
  abilities: Ability[];
  perks: {
    minor: Perk[];
    major: Perk[];
  };
  stats: HeroStats;
}

export interface SourceAttribution {
  name: string;
  url: string;
  license: string;
  license_url?: string;
  fields: string[];
}

export interface Metadata {
  last_updated: string;
  patch_version: string;
  hero_count: number;
  heroes_failed: string[];
  fandom_failed: string[];
  sources: SourceAttribution[];
  schema_version: string;
}

export interface PerHeroAttribution {
  fandom_page: string;
  blizzard_page: string;
}

export interface RosterEntry {
  slug: string;
  name: string;
  role: Role;
  sub_role?: string;
  portrait_url?: string;
}

export interface ScrapeResult {
  heroes: Record<string, Hero>;
  failed: Array<{ slug: string; reason: string }>;
  patchVersion: string;
}

export type SelectorTier = 1 | 2 | 3;

export interface SelectorMatch {
  tier: SelectorTier;
  note: string;
}
