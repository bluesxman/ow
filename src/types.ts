export type Role = 'tank' | 'damage' | 'support';

export interface Perk {
  name: string;
  description: string;
}

export interface Ability {
  name: string;
  description: string;
}

export interface AbilityStat {
  damage?: number | string;
  cooldown?: number | string;
  range?: number | string;
  duration?: number | string;
  ammo?: number | string;
  [key: string]: number | string | undefined;
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

export interface Metadata {
  last_updated: string;
  patch_version: string;
  hero_count: number;
  heroes_failed: string[];
  source: string;
  schema_version: string;
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
