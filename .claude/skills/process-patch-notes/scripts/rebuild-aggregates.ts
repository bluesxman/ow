#!/usr/bin/env node
// Rebuilds the six aggregate JSON files under data/ from the per-hero files
// in data/heroes/. Used after the skill edits individual hero JSONs so the
// aggregates stay in sync. Metadata and the roster come from the existing
// data/index.json — the skill never owns them.

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { buildAggregates, buildPaths, writeLinks } from '../../../../src/publish.js';
import type { Hero, Metadata, RosterEntry } from '../../../../src/types.js';

interface IndexDoc {
  metadata: Metadata;
  heroes: Array<{ slug: string; name: string; role: RosterEntry['role'] }>;
}

async function main(): Promise<void> {
  const root = resolve(process.cwd());
  const paths = buildPaths(root);

  const indexPath = join(paths.dataDir, 'index.json');
  const index = JSON.parse(await readFile(indexPath, 'utf8')) as IndexDoc;

  const heroesBySlug: Record<string, Hero> = {};

  const files = await readdir(paths.heroesDir);
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const slug = f.slice(0, -5);
    const doc = JSON.parse(await readFile(join(paths.heroesDir, f), 'utf8')) as {
      hero: Hero;
    };
    heroesBySlug[slug] = doc.hero;
  }

  const roster: RosterEntry[] = Object.entries(heroesBySlug).map(([slug, hero]) => {
    const entry: RosterEntry = { slug, name: hero.name, role: hero.role };
    if (hero.sub_role) entry.sub_role = hero.sub_role;
    if (hero.portrait_url) entry.portrait_url = hero.portrait_url;
    return entry;
  });

  const aggregates = buildAggregates(heroesBySlug, roster, index.metadata);

  const outputs: Array<[string, unknown]> = [
    [join(paths.dataDir, 'index.json'), aggregates.indexDoc],
    [join(paths.dataDir, 'heroes.json'), aggregates.heroesDoc],
    [join(paths.dataDir, 'perks.json'), aggregates.perksDoc],
    [join(paths.dataDir, 'abilities.json'), aggregates.abilitiesDoc],
    [join(paths.dataDir, 'stats.json'), aggregates.statsDoc],
    [join(paths.dataDir, 'all.json'), aggregates.allDoc],
    [join(paths.dataDir, 'schema.json'), aggregates.schemaDoc],
  ];

  for (const [path, value] of outputs) {
    const body = JSON.stringify(value, null, 2) + '\n';
    await writeFile(path, body, 'utf8');
  }

  await writeLinks(paths.linksPath, aggregates.links, index.metadata);

  console.log(`rebuilt ${outputs.length} aggregate files + links.md under ${dirname(outputs[0]![0])}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
