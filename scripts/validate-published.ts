import process from 'node:process';
import { normalizeForCompare } from '../src/normalize.js';

const BASE = process.env['OW_RAW_BASE'] ?? 'https://raw.githubusercontent.com/bluesxman/ow/main/data';
const MAX_AGE_DAYS = 8;

const EXPECTED = {
  reaper: {
    minor: ['Soul Reaving', 'Lingering Wraith'],
    major: ['Shadow Blink', 'Trigger Finger'],
  },
  vendetta: {
    minor: ['Extra Edge', 'Raging Storm'],
    major: ['Siphoning Strike', 'Relentless'],
  },
};

interface SourceEntry {
  name: string;
  url: string;
  license: string;
  license_url?: string;
  fields?: string[];
}

interface FetchedMetadata {
  last_updated: string;
  patch_version: string;
  sources?: SourceEntry[];
  schema_version?: string;
}

interface AbilityStat {
  [key: string]: number | string | boolean | undefined;
}

interface HeroStats {
  health?: number;
  armor?: number;
  shields?: number;
}

interface AbilityEntry extends AbilityStat {
  name: string;
  description?: string;
}

interface HeroFile {
  metadata: FetchedMetadata;
  attribution?: { fandom_page?: string; blizzard_page?: string };
  hero: {
    slug: string;
    abilities: AbilityEntry[];
    perks: { minor: Array<{ name: string }>; major: Array<{ name: string }> };
    stats?: HeroStats;
  };
}

interface IndexFile {
  metadata: FetchedMetadata;
  files?: Record<string, string>;
  heroes: Array<{ slug: string; name: string; role: string }>;
}

interface AggregateFile {
  metadata: FetchedMetadata;
  heroes: Record<string, { stats?: HeroStats; abilities?: AbilityEntry[] }>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

function ageDays(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

function assertPerks(slug: string, got: string[], expected: string[]): void {
  const g = new Set(got.map(normalizeForCompare));
  for (const name of expected) {
    if (!g.has(normalizeForCompare(name))) {
      throw new Error(`${slug}: expected perk "${name}" not in [${got.join(', ')}]`);
    }
  }
}

function assertSources(label: string, metadata: FetchedMetadata): void {
  if (!Array.isArray(metadata.sources) || metadata.sources.length === 0) {
    throw new Error(`${label}: metadata.sources is missing or empty`);
  }
  const names = metadata.sources.map((s) => s.name.toLowerCase());
  if (!names.some((n) => n.includes('blizzard'))) {
    throw new Error(`${label}: metadata.sources missing Blizzard entry (got: ${names.join(', ')})`);
  }
  if (!names.some((n) => n.includes('fandom'))) {
    throw new Error(`${label}: metadata.sources missing Fandom entry (got: ${names.join(', ')})`);
  }
  for (const s of metadata.sources) {
    if (!s.name || !s.url || !s.license) {
      throw new Error(`${label}: source entry missing name/url/license: ${JSON.stringify(s)}`);
    }
  }
}

function hasFandomData(hero: { stats?: HeroStats; abilities?: AbilityEntry[] }): boolean {
  const s = hero.stats;
  if (s && (s.health !== undefined || s.armor !== undefined || s.shields !== undefined)) return true;
  if (hero.abilities && hero.abilities.length > 0) {
    // Look for any numeric/string stat field beyond the bare name+description.
    return hero.abilities.some((a) => {
      const keys = Object.keys(a);
      return keys.some((k) => k !== 'name' && k !== 'description');
    });
  }
  return false;
}

function fandomInSources(metadata: FetchedMetadata): boolean {
  return (metadata.sources ?? []).some((s) => s.name.toLowerCase().includes('fandom'));
}

async function main(): Promise<void> {
  console.log(`Fetching ${BASE}/index.json`);
  const index = await fetchJson<IndexFile>(`${BASE}/index.json`);
  const age = ageDays(index.metadata.last_updated);
  if (age > MAX_AGE_DAYS) {
    throw new Error(`index.json is ${age.toFixed(1)} days old (> ${MAX_AGE_DAYS}) — scraper may be silently broken`);
  }
  console.log(`index.json age ${age.toFixed(1)}d, hero_count=${index.heroes.length}, schema_version=${index.metadata.schema_version ?? '<missing>'}`);
  assertSources('index.json', index.metadata);

  const aggregateNames = ['heroes.json', 'perks.json', 'abilities.json', 'stats.json', 'all.json'];
  for (const name of aggregateNames) {
    const url = `${BASE}/${name}`;
    console.log(`Fetching ${url}`);
    const doc = await fetchJson<AggregateFile>(url);
    assertSources(name, doc.metadata);
  }

  const statsAgg = await fetchJson<AggregateFile>(`${BASE}/stats.json`);
  let heroesWithFandomStats = 0;
  for (const hero of Object.values(statsAgg.heroes)) {
    if (hasFandomData(hero)) heroesWithFandomStats++;
  }
  if (heroesWithFandomStats === 0) {
    throw new Error('stats.json: no hero has Fandom-derived stats — enrichment likely failed entirely');
  }
  if (!fandomInSources(statsAgg.metadata)) {
    throw new Error('stats.json: contains stats but Fandom not in metadata.sources');
  }
  console.log(`stats.json: ${heroesWithFandomStats}/${Object.keys(statsAgg.heroes).length} heroes have Fandom-derived stats`);

  for (const [slug, expected] of Object.entries(EXPECTED)) {
    const url = `${BASE}/heroes/${slug}.json`;
    console.log(`Fetching ${url}`);
    const doc = await fetchJson<HeroFile>(url);
    assertSources(`heroes/${slug}.json`, doc.metadata);
    assertPerks(slug, doc.hero.perks.minor.map((p) => p.name), expected.minor);
    assertPerks(slug, doc.hero.perks.major.map((p) => p.name), expected.major);

    const fandomPage = doc.attribution?.fandom_page;
    const blizzardPage = doc.attribution?.blizzard_page;
    if (!fandomPage || !blizzardPage) {
      throw new Error(`heroes/${slug}.json: attribution missing fandom_page or blizzard_page`);
    }
    if (!fandomPage.startsWith('https://overwatch.fandom.com/wiki/')) {
      throw new Error(`heroes/${slug}.json: fandom_page wrong host: ${fandomPage}`);
    }
    if (!blizzardPage.startsWith('https://overwatch.blizzard.com/en-us/heroes/')) {
      throw new Error(`heroes/${slug}.json: blizzard_page wrong host: ${blizzardPage}`);
    }

    if (hasFandomData(doc.hero) && !fandomInSources(doc.metadata)) {
      throw new Error(`heroes/${slug}.json: contains Fandom-derived data but Fandom not in metadata.sources`);
    }

    console.log(`  ${slug}: perks match, attribution OK${hasFandomData(doc.hero) ? ', stats present' : ''}`);
  }

  console.log('All checks passed.');
}

main().catch((err) => {
  console.error('Validation failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
