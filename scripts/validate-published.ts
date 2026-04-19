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

interface FetchedMetadata {
  last_updated: string;
  patch_version: string;
}

interface HeroFile {
  metadata: FetchedMetadata;
  hero: {
    slug: string;
    perks: { minor: Array<{ name: string }>; major: Array<{ name: string }> };
  };
}

interface IndexFile {
  metadata: FetchedMetadata;
  heroes: Array<{ slug: string; name: string; role: string }>;
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

async function main(): Promise<void> {
  console.log(`Fetching ${BASE}/index.json`);
  const index = await fetchJson<IndexFile>(`${BASE}/index.json`);
  const age = ageDays(index.metadata.last_updated);
  if (age > MAX_AGE_DAYS) {
    throw new Error(`index.json is ${age.toFixed(1)} days old (> ${MAX_AGE_DAYS}) — scraper may be silently broken`);
  }
  console.log(`index.json age ${age.toFixed(1)}d, hero_count=${index.heroes.length}`);

  for (const [slug, expected] of Object.entries(EXPECTED)) {
    const url = `${BASE}/heroes/${slug}.json`;
    console.log(`Fetching ${url}`);
    const doc = await fetchJson<HeroFile>(url);
    assertPerks(slug, doc.hero.perks.minor.map((p) => p.name), expected.minor);
    assertPerks(slug, doc.hero.perks.major.map((p) => p.name), expected.major);
    console.log(`  ${slug}: perks match expected`);
  }
  console.log('All checks passed.');
}

main().catch((err) => {
  console.error('Validation failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
