export type Role = 'tank' | 'damage' | 'support';

export interface Perk {
  name: string;
  description: string;
}

export interface AbilityMode {
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
  health?: number | string;
  dps?: number | string;
  movement_speed?: number | string;
  ability_type?: string;
  key?: string;
  [key: string]: number | string | boolean | undefined;
}

export interface Ability {
  name: string;
  description: string;
  ability_type?: string;
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
  health?: number | string;
  dps?: number | string;
  movement_speed?: number | string;
  modes?: Record<string, AbilityMode>;
  [key: string]: number | string | boolean | Record<string, AbilityMode> | undefined;
}

export interface HeroStats {
  health?: number;
  armor?: number;
  shields?: number;
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

// ---------------------------------------------------------------------------
// Patch-notes types
//
// Two layers per change item:
//   - `raw`: exactly what Blizzard wrote — preserved verbatim so we can re-derive
//     interpretation later if it changes.
//   - `interpreted`: AI judgment about what the bullet refers to. Conservative;
//     may be null when the source is too ambiguous.
//
// The deterministic scrape pipeline only produces the `raw` layer (and section
// boundaries). The interpreted layer is filled in by the refresh-patch-notes
// Claude Code skill, which reads the raw scrape output and applies AI judgment.
// ---------------------------------------------------------------------------

// What the change is being applied to. `hero_general` covers hero-level
// bullets that aren't tied to a single ability (e.g. "Re-enabled.", role
// passives, hero-wide perk-cost lines). `unknown` is the escape hatch when
// the AI can't determine the subject confidently.
export type PatchSubjectKind =
  | 'hero_general'
  | 'ability'
  | 'perk'
  | 'role'
  | 'system'
  | 'map'
  | 'unknown';

// Game mode the change applies to. Stadium is a separate game mode with
// different Powers/Items/costs; retail covers Quick Play / Competitive /
// Mystery Heroes / etc. `mixed` is rare but appears for cross-mode changes.
export type PatchMode = 'retail' | 'stadium' | 'mixed' | 'unknown';

// Common metrics we extract from "X reduced from A to B"-style bullets.
// Free-form `metric` is allowed for anything outside this list.
export type PatchMetric =
  | 'damage'
  | 'cooldown'
  | 'duration'
  | 'range'
  | 'radius'
  | 'healing'
  | 'health'
  | 'shields'
  | 'armor'
  | 'ammo'
  | 'reload'
  | 'rate_of_fire'
  | 'movement_speed'
  | 'spread'
  | 'projectile_speed'
  | 'pellets'
  | 'cost'
  | 'ultimate_cost'
  | 'attack_speed'
  | 'energy'
  | 'other';

export interface PatchChangeRaw {
  // The bullet text exactly as Blizzard published it.
  text: string;
}

export interface PatchChangeInterpreted {
  // What is this change about?
  mode: PatchMode;
  subject_kind: PatchSubjectKind;
  // Hero this change applies to (slug). Null when the subject isn't a hero
  // (system updates, map changes, etc.) or when context isn't clear.
  hero_slug: string | null;
  // Display name of the specific subject — ability name, perk name, hero name
  // for hero-general, or whatever Blizzard's bracketed prefix points at.
  // Null when the subject is structural (system / unknown).
  subject_name: string | null;

  // What's changing (when extractable). Free-form `metric` falls back to
  // "other" with the natural-language phrase preserved in `metric_phrase`.
  metric: PatchMetric | null;
  metric_phrase: string | null;

  // Numeric deltas when the bullet states them clearly. Strings allowed
  // because Blizzard often writes percentages, ranges, or composite values
  // (e.g. "300 / 750 (during Rally)"). Null when the bullet is qualitative.
  from: number | string | null;
  to: number | string | null;
  delta: number | string | null;

  // Surface any inline Blizzard commentary the AI extracted from the bullet
  // (e.g. dev notes, parenthetical caveats, "(6v6)" qualifiers). Empty array
  // when no commentary is present.
  blizzard_commentary: string[];

  // AI-authored note explaining the call when the source is ambiguous —
  // e.g. "subject inferred from surrounding bullets in the same hero block",
  // "Stadium-mode bullet, no specific power named". Empty string when the
  // interpretation is unambiguous.
  notes: string;
}

export interface PatchChange {
  raw: PatchChangeRaw;
  // Null when the AI couldn't derive a confident interpretation. Consumers
  // should always fall back to `raw.text`.
  interpreted: PatchChangeInterpreted | null;
}

export interface PatchSection {
  // Section title as it appears on Blizzard's page (e.g. "Damage", "Stadium
  // Hero Updates", "Bug Fixes").
  title: string;
  // Section-level mode hint. Set by the AI based on the title and context.
  // Items inside still carry their own `interpreted.mode` because a Stadium
  // bullet can sometimes appear inside a "Bug Fixes" section.
  mode: PatchMode;
  // Optional subject grouping label — typically a hero name when the section
  // groups all changes for that hero, or a general topic ("Map Voting Updates").
  // Null when the section is a flat list with no grouping.
  group_label: string | null;
  changes: PatchChange[];
}

export interface ParsedPatch {
  // ISO yyyy-mm-dd.
  date: string;
  // Title as Blizzard published it.
  title: string;
  // Optional URL to the patch notes article (when Blizzard links one).
  url: string | null;
  sections: PatchSection[];
}

export interface PatchNotesDoc {
  metadata: Metadata;
  patches: ParsedPatch[];
}

export type SelectorTier = 1 | 2 | 3;

export interface SelectorMatch {
  tier: SelectorTier;
  note: string;
}
