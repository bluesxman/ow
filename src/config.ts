export const BASE_URL = 'https://overwatch.blizzard.com';
export const HEROES_INDEX_URL = `${BASE_URL}/en-us/heroes/`;
export const PATCH_NOTES_URL = `${BASE_URL}/en-us/news/patch-notes/`;

export const HERO_PAGE_TIMEOUT_MS = 20_000;
export const HERO_LIST_TIMEOUT_MS = 20_000;
export const NAV_TIMEOUT_MS = 30_000;

export const MIN_EXPECTED_HEROES = 30;
export const MAX_HERO_FAILURES_BEFORE_ABORT = 5;

export const SCHEMA_VERSION = '1';

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
  'ow-data-pipeline/0.1 (+https://github.com/) claude-ai-consumer';

export const PUBLISHED_DATA_SOURCE = HEROES_INDEX_URL;
