#!/usr/bin/env tsx
// Reads the windowed patch-notes markdown and cross-references it with
// data/heroes/*.json to produce a narrow working set the skill can act on.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { toSlug } from '../../../../src/slug.js';
import type { Hero } from '../../../../src/types.js';

const DEFAULT_IN = '.run/patch-notes.md';
const DEFAULT_OUT = '.run/patch-affected.json';
const DEFAULT_HEROES_DIR = 'data/heroes';

interface ParsedArgs {
  in: string;
  out: string;
  heroesDir: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { in: DEFAULT_IN, out: DEFAULT_OUT, heroesDir: DEFAULT_HEROES_DIR };
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    if (m[1] === 'in') args.in = m[2]!;
    else if (m[1] === 'out') args.out = m[2]!;
    else if (m[1] === 'heroes-dir') args.heroesDir = m[2]!;
  }
  return args;
}

// Re-export the canonical name-to-slug helper so existing callers and tests
// keep a stable import name. The implementation lives in src/slug.ts.
export const nameToSlug = toSlug;

interface ParsedHeroEntry {
  abilities: Set<string>;
  heroLevel: string[];
}

// Parse the markdown produced by fetch-blizzard-patches.ts. Structure:
//   ## <patch title>
//   ### <section title>
//   #### <hero name>
//   - **<ability name>**
//     - bullet
//   - general bullet
export function parsePatchMarkdown(md: string): Map<string, ParsedHeroEntry> {
  const lines = md.split('\n');
  const heroes = new Map<string, ParsedHeroEntry>();
  let currentHero: string | null = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.startsWith('#### ')) {
      const heroName = line.slice(5).trim();
      if (!heroes.has(heroName)) heroes.set(heroName, { abilities: new Set(), heroLevel: [] });
      currentHero = heroName;
      continue;
    }
    if (line.startsWith('### ') || line.startsWith('## ')) {
      currentHero = null;
      continue;
    }
    if (!currentHero) continue;
    const entry = heroes.get(currentHero);
    if (!entry) continue;

    const topBullet = line.match(/^-\s+\*\*([^*]+)\*\*\s*$/);
    if (topBullet) {
      entry.abilities.add(topBullet[1]!.trim());
      continue;
    }
    if (/^-\s+/.test(line)) {
      entry.heroLevel.push(line.replace(/^-\s+/, '').trim());
      continue;
    }
    if (/^\s{2}-\s+/.test(line)) {
      // sub-bullet under an ability — ignored at this level
      continue;
    }
  }
  return heroes;
}

interface HeroDoc {
  hero: Hero;
}

async function readHeroJson(path: string): Promise<HeroDoc> {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as HeroDoc;
}

async function loadHeroes(heroesDir: string): Promise<Record<string, Hero>> {
  const dir = resolve(process.cwd(), heroesDir);
  const files = await readdir(dir);
  const bySlug: Record<string, Hero> = {};
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const slug = f.slice(0, -5);
    const doc = await readHeroJson(resolve(dir, f));
    bySlug[slug] = doc.hero;
  }
  return bySlug;
}

interface AffectedEntry {
  slug: string;
  name: string;
  abilities: string[];
  skipped_abilities: string[];
  hero_level_bullets: string[];
}

interface AffectedReport {
  affected: AffectedEntry[];
  unmatched: Array<{ hero: string; reason: string }>;
}

export function buildAffected(
  parsed: Map<string, ParsedHeroEntry>,
  heroesBySlug: Record<string, Hero>,
): AffectedReport {
  const affected: AffectedEntry[] = [];
  const unmatched: AffectedReport['unmatched'] = [];

  for (const [heroName, entry] of parsed.entries()) {
    const slug = nameToSlug(heroName);
    const hero = heroesBySlug[slug];
    if (!hero) {
      unmatched.push({ hero: heroName, reason: `slug "${slug}" not in data/heroes/` });
      continue;
    }

    const abilityNames = (hero.abilities ?? []).map((a) => a.name);
    const abilityKeysLower = new Map(abilityNames.map((k) => [k.toLowerCase(), k]));
    const perkNames = new Set<string>();
    for (const p of hero.perks?.minor ?? []) perkNames.add(p.name.toLowerCase());
    for (const p of hero.perks?.major ?? []) perkNames.add(p.name.toLowerCase());

    const matchedAbilities: string[] = [];
    const skippedAbilities: string[] = [];
    for (const mentioned of entry.abilities) {
      const stripped = mentioned
        .replace(/\s*[–—-]\s*(Major|Minor)\s*Perk\s*$/i, '')
        .replace(/^\[(.+)\]$/, '$1')
        .trim();
      const key = stripped.toLowerCase();
      const existingKey = abilityKeysLower.get(key);
      if (existingKey) {
        matchedAbilities.push(existingKey);
      } else if (perkNames.has(key)) {
        matchedAbilities.push(stripped);
      } else {
        skippedAbilities.push(mentioned);
      }
    }

    affected.push({
      slug,
      name: hero.name,
      abilities: matchedAbilities,
      skipped_abilities: skippedAbilities,
      hero_level_bullets: entry.heroLevel,
    });
  }

  affected.sort((a, b) => a.slug.localeCompare(b.slug));
  return { affected, unmatched };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const mdPath = resolve(process.cwd(), args.in);
  const md = await readFile(mdPath, 'utf8');
  const parsed = parsePatchMarkdown(md);
  const heroes = await loadHeroes(args.heroesDir);
  const report = buildAffected(parsed, heroes);

  const outPath = resolve(process.cwd(), args.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(
    `wrote ${outPath} — ${report.affected.length} affected, ${report.unmatched.length} unmatched`,
  );
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
}
