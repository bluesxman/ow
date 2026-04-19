import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Hero, Metadata, RosterEntry } from './types.js';
import { renderDiffMarkdown, type HeroDiff } from './diff.js';

export interface PublishPaths {
  dataDir: string;
  heroesDir: string;
  previousDir: string;
  changelogPath: string;
}

export function buildPaths(root: string): PublishPaths {
  const dataDir = resolve(root, 'data');
  return {
    dataDir,
    heroesDir: join(dataDir, 'heroes'),
    previousDir: join(dataDir, '.previous'),
    changelogPath: join(dataDir, 'CHANGELOG.md'),
  };
}

export async function readPreviousHeroes(paths: PublishPaths): Promise<Record<string, Hero>> {
  const allPath = join(paths.dataDir, 'all.json');
  try {
    const raw = await readFile(allPath, 'utf8');
    const parsed = JSON.parse(raw) as { heroes: Record<string, Hero> };
    return parsed.heroes ?? {};
  } catch {
    return {};
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const body = JSON.stringify(value, null, 2) + '\n';
  await writeFile(path, body, 'utf8');
  const roundtrip = await readFile(path, 'utf8');
  JSON.parse(roundtrip);
}

export interface PublishInput {
  heroes: Record<string, Hero>;
  roster: RosterEntry[];
  metadata: Metadata;
  diff: HeroDiff;
  dryRun: boolean;
  root: string;
}

export async function publish(input: PublishInput): Promise<{ paths: PublishPaths; filesWritten: string[] }> {
  const { heroes, roster, metadata, diff, dryRun, root } = input;
  const paths = buildPaths(root);
  const filesWritten: string[] = [];

  const slugs = Object.keys(heroes).sort();
  const rosterSorted = [...roster].sort((a, b) => a.slug.localeCompare(b.slug));

  const indexFiles: Record<string, string> = {
    heroes: 'heroes.json',
    perks: 'perks.json',
    abilities: 'abilities.json',
    stats: 'stats.json',
    all: 'all.json',
    per_hero_dir: 'heroes/',
  };

  const indexDoc = {
    metadata,
    files: indexFiles,
    heroes: rosterSorted.map((r) => ({ slug: r.slug, name: r.name, role: r.role })),
  };

  const heroesDoc = { metadata, heroes: rosterSorted };

  const perksDoc = {
    metadata,
    heroes: Object.fromEntries(slugs.map((s) => [s, { perks: heroes[s]!.perks }])),
  };

  const abilitiesDoc = {
    metadata,
    heroes: Object.fromEntries(slugs.map((s) => [s, { abilities: heroes[s]!.abilities }])),
  };

  const statsDoc = {
    metadata,
    heroes: Object.fromEntries(slugs.map((s) => [s, { stats: heroes[s]!.stats }])),
  };

  const allDoc = {
    metadata,
    heroes: Object.fromEntries(slugs.map((s) => [s, heroes[s]!])),
  };

  if (dryRun) {
    console.log(`[dry-run] would write ${slugs.length} per-hero files + 6 aggregate files`);
    return { paths, filesWritten: [] };
  }

  await mkdir(paths.dataDir, { recursive: true });
  await mkdir(paths.heroesDir, { recursive: true });
  await mkdir(paths.previousDir, { recursive: true });

  await rotatePrevious(paths);

  const topLevel: Array<[string, unknown]> = [
    [join(paths.dataDir, 'index.json'), indexDoc],
    [join(paths.dataDir, 'heroes.json'), heroesDoc],
    [join(paths.dataDir, 'perks.json'), perksDoc],
    [join(paths.dataDir, 'abilities.json'), abilitiesDoc],
    [join(paths.dataDir, 'stats.json'), statsDoc],
    [join(paths.dataDir, 'all.json'), allDoc],
  ];

  for (const [path, value] of topLevel) {
    await writeJson(path, value);
    filesWritten.push(path);
  }

  await clearPerHeroFiles(paths.heroesDir);
  for (const slug of slugs) {
    const path = join(paths.heroesDir, `${slug}.json`);
    await writeJson(path, { metadata, hero: heroes[slug] });
    filesWritten.push(path);
  }

  await prependChangelog(paths.changelogPath, diff, metadata);

  return { paths, filesWritten };
}

async function rotatePrevious(paths: PublishPaths): Promise<void> {
  const files = ['index.json', 'heroes.json', 'perks.json', 'abilities.json', 'stats.json', 'all.json'];
  for (const f of files) {
    try {
      const src = join(paths.dataDir, f);
      const dst = join(paths.previousDir, f);
      const body = await readFile(src, 'utf8');
      await writeFile(dst, body, 'utf8');
    } catch {}
  }
}

async function clearPerHeroFiles(dir: string): Promise<void> {
  try {
    const entries = await readdir(dir);
    await Promise.all(
      entries.filter((e: string) => e.endsWith('.json')).map((e: string) => rm(join(dir, e), { force: true })),
    );
  } catch {}
}

async function prependChangelog(path: string, diff: HeroDiff, metadata: Metadata): Promise<void> {
  const date = metadata.last_updated.slice(0, 10);
  const section = renderDiffMarkdown(diff, date, metadata.patch_version);
  let existing = '';
  try {
    existing = await readFile(path, 'utf8');
  } catch {}
  const header = existing.startsWith('# Changelog')
    ? ''
    : '# Changelog\n\nAuto-generated per-run diffs. Newest first.\n\n';
  const withoutHeader = existing.replace(/^# Changelog[\s\S]*?\n\n/, '');
  await writeFile(path, `${header}${section}\n${withoutHeader}`, 'utf8');
}
