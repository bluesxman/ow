import type { SourceAttribution } from './types.js';

export const BASE_URL = 'https://overwatch.blizzard.com';
export const HEROES_INDEX_URL = `${BASE_URL}/en-us/heroes/`;
export const PATCH_NOTES_URL = `${BASE_URL}/en-us/news/patch-notes/`;

export const HERO_PAGE_TIMEOUT_MS = 20_000;
export const HERO_LIST_TIMEOUT_MS = 20_000;
export const NAV_TIMEOUT_MS = 30_000;

export const MIN_EXPECTED_HEROES = 30;
export const MAX_HERO_FAILURES_BEFORE_ABORT = 5;

// Semver. Major: breaking schema change. Minor: non-breaking schema change.
// Patch: data only, no schema change. See AGENTS.md for the full policy.
export const SCHEMA_VERSION = '5.1.0';

export const PUBLISHED_RAW_BASE = 'https://raw.githubusercontent.com/bluesxman/ow/main/data';

export const SLUG_OVERRIDES: Record<string, string> = {
  'soldier: 76': 'soldier-76',
  'soldier:76': 'soldier-76',
  'd.va': 'dva',
  'd. va': 'dva',
  'wrecking ball': 'wrecking-ball',
  'junker queen': 'junker-queen',
  'lúcio': 'lucio',
  'lucio': 'lucio',
  'torbjörn': 'torbjorn',
  'torbjorn': 'torbjorn',
};

export const USER_AGENT =
  'ow-hero-data/0.1 (jon.newton@gmail.com; +https://github.com/bluesxman/ow)';

export const FANDOM_API_URL = 'https://overwatch.fandom.com/api.php';
export const FANDOM_WIKI_BASE_URL = 'https://overwatch.fandom.com/wiki';
export const FANDOM_MIN_INTERVAL_MS = 2_500;
export const FANDOM_TIMEOUT_MS = 15_000;
export const FANDOM_MAX_RETRIES = 3;

export const DATA_SOURCES: SourceAttribution[] = [
  {
    name: 'Blizzard Entertainment',
    url: HEROES_INDEX_URL,
    license: 'Blizzard Terms of Service',
    fields: ['name', 'role', 'portrait_url', 'patch_version'],
  },
  {
    name: 'Overwatch Fandom Wiki',
    url: 'https://overwatch.fandom.com/',
    license: 'CC-BY-SA 3.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/3.0/',
    fields: [
      'sub_role',
      'abilities',
      'perks.minor',
      'perks.major',
      'stats.health',
      'stats.armor',
      'stats.shields',
    ],
  },
];
