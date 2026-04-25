#!/usr/bin/env node
// Reads the windowed patch-notes markdown and cross-references it with
// data/heroes/*.json to produce a narrow working set the skill can act on.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_IN = '.run/patch-notes.md';
const DEFAULT_OUT = '.run/patch-affected.json';
const DEFAULT_HEROES_DIR = 'data/heroes';

// Name-to-slug overrides mirroring src/config.ts SLUG_OVERRIDES. Kept in sync
// by the slug.test.ts contract — update both sides together when heroes
// change.
const SLUG_OVERRIDES = {
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

function parseArgs(argv) {
  const args = { in: DEFAULT_IN, out: DEFAULT_OUT, heroesDir: DEFAULT_HEROES_DIR };
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    if (m[1] === 'in') args.in = m[2];
    else if (m[1] === 'out') args.out = m[2];
    else if (m[1] === 'heroes-dir') args.heroesDir = m[2];
  }
  return args;
}

export function nameToSlug(heroName) {
  const key = heroName.trim().toLowerCase();
  if (SLUG_OVERRIDES[key]) return SLUG_OVERRIDES[key];
  const decomposed = heroName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return decomposed
    .toLowerCase()
    .replace(/[:'']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Parse the markdown produced by fetch-blizzard-patches.mjs. Structure:
//   ## <patch title>
//   ### <section title>
//   #### <hero name>
//   - **<ability name>**
//     - bullet
//   - general bullet
export function parsePatchMarkdown(md) {
  const lines = md.split('\n');
  const heroes = new Map(); // heroName -> { abilities: Set<string>, heroLevel: string[] }
  let currentHero = null;
  let currentAbility = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.startsWith('#### ')) {
      const heroName = line.slice(5).trim();
      if (!heroes.has(heroName)) heroes.set(heroName, { abilities: new Set(), heroLevel: [] });
      currentHero = heroName;
      currentAbility = null;
      continue;
    }
    if (line.startsWith('### ') || line.startsWith('## ')) {
      currentHero = null;
      currentAbility = null;
      continue;
    }
    if (!currentHero) continue;
    const entry = heroes.get(currentHero);
    if (!entry) continue;

    const topBullet = line.match(/^-\s+\*\*([^*]+)\*\*\s*$/);
    if (topBullet) {
      currentAbility = topBullet[1].trim();
      entry.abilities.add(currentAbility);
      continue;
    }
    if (/^-\s+/.test(line)) {
      // Plain top-level bullet — not under an ability. Always hero-level.
      currentAbility = null;
      entry.heroLevel.push(line.replace(/^-\s+/, '').trim());
      continue;
    }
    if (/^\s{2}-\s+/.test(line)) {
      continue;
    }
  }
  return heroes;
}

async function readHeroJson(path) {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

async function loadHeroes(heroesDir) {
  const dir = resolve(process.cwd(), heroesDir);
  const files = await readdir(dir);
  const bySlug = {};
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const slug = f.slice(0, -5);
    const doc = await readHeroJson(resolve(dir, f));
    bySlug[slug] = doc.hero;
  }
  return bySlug;
}

export function buildAffected(parsed, heroesBySlug) {
  const affected = [];
  const unmatched = [];

  for (const [heroName, entry] of parsed.entries()) {
    const slug = nameToSlug(heroName);
    const hero = heroesBySlug[slug];
    if (!hero) {
      unmatched.push({ hero: heroName, reason: `slug "${slug}" not in data/heroes/` });
      continue;
    }

    const abilityKeys = Object.keys(hero.stats?.abilities ?? {});
    const abilityKeysLower = new Map(abilityKeys.map((k) => [k.toLowerCase(), k]));
    const perkNames = new Set();
    for (const p of hero.perks?.minor ?? []) perkNames.add(p.name.toLowerCase());
    for (const p of hero.perks?.major ?? []) perkNames.add(p.name.toLowerCase());

    const matchedAbilities = [];
    const skippedAbilities = [];
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

async function main() {
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
    console.error(err?.stack ?? String(err));
    process.exit(1);
  });
}
