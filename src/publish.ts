import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { PUBLISHED_RAW_BASE } from './config.js';
import type { Hero, Metadata, ParsedPatch, RosterEntry } from './types.js';
import { isEmptyDiff, renderDiffMarkdown, type HeroDiff } from './diff.js';
import { slugToBlizzardUrl, slugToFandomUrl } from './sources/slugToFandomTitle.js';
import { HeroSchema, PatchNotesDocSchema } from './validate.js';

export interface PublishPaths {
  dataDir: string;
  heroesDir: string;
  changelogPath: string;
  attributionPath: string;
  licensePath: string;
  linksPath: string;
  patchNotesPath: string;
}

export function buildPaths(root: string): PublishPaths {
  const dataDir = resolve(root, 'data');
  return {
    dataDir,
    heroesDir: join(dataDir, 'heroes'),
    changelogPath: join(dataDir, 'CHANGELOG.md'),
    attributionPath: join(dataDir, 'ATTRIBUTION.md'),
    licensePath: join(dataDir, 'LICENSE'),
    linksPath: join(dataDir, 'links.md'),
    patchNotesPath: join(dataDir, 'patch-notes.json'),
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

export async function readPreviousPatches(paths: PublishPaths): Promise<ParsedPatch[]> {
  try {
    const raw = await readFile(paths.patchNotesPath, 'utf8');
    const parsed = JSON.parse(raw) as { patches?: ParsedPatch[] };
    return Array.isArray(parsed.patches) ? parsed.patches : [];
  } catch {
    return [];
  }
}

// Merge prior patches with the freshly-scraped list, keyed by `date`. The
// freshly-scraped entry wins on conflict (Blizzard occasionally edits notes),
// but prior entries with no fresh counterpart are preserved — this is how the
// history accumulates across scrapes after Blizzard's page rotates older
// patches off the rolling feed. Output is sorted newest-first.
export function mergePatches(prior: ParsedPatch[], fresh: ParsedPatch[]): ParsedPatch[] {
  const byDate = new Map<string, ParsedPatch>();
  for (const p of prior) byDate.set(p.date, p);
  for (const p of fresh) byDate.set(p.date, p);
  const out = Array.from(byDate.values());
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
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
  patches: ParsedPatch[];
}

export interface PublishedLinks {
  top_level: Record<string, string>;
  per_hero: Record<string, string>;
}

export interface Aggregates {
  indexDoc: unknown;
  heroesDoc: unknown;
  perksDoc: unknown;
  abilitiesDoc: unknown;
  statsDoc: unknown;
  allDoc: unknown;
  schemaDoc: unknown;
  patchNotesDoc: unknown;
  patchNotesSchemaDoc: unknown;
  links: PublishedLinks;
}

export function buildAggregates(
  heroes: Record<string, Hero>,
  roster: RosterEntry[],
  metadata: Metadata,
  patches: ParsedPatch[] = [],
): Aggregates {
  const slugs = Object.keys(heroes).sort();
  const rosterSorted = [...roster].sort((a, b) => a.slug.localeCompare(b.slug));

  const indexFiles: Record<string, { path: string; description: string }> = {
    heroes: {
      path: 'heroes.json',
      description: 'Roster only — slug, name, role, sub_role, portrait_url. No perks/abilities/stats.',
    },
    perks: {
      path: 'perks.json',
      description: 'Minor + major perks for every hero, keyed by slug.',
    },
    abilities: {
      path: 'abilities.json',
      description: 'Ability names + descriptions for every hero, keyed by slug. No numeric stats.',
    },
    stats: {
      path: 'stats.json',
      description: 'HP/armor/shields and per-ability numeric stats (damage, ammo, falloff, cooldown, etc.) for every hero, keyed by slug.',
    },
    all: {
      path: 'all.json',
      description: 'Complete denormalized dump — every field for every hero in one file. Largest payload.',
    },
    per_hero: {
      path: 'heroes/{slug}.json',
      description: 'Single hero — same content as a slice of all.json plus a per-hero attribution block. Cheapest fetch for one-hero queries.',
    },
    schema: {
      path: 'schema.json',
      description: 'JSON Schema (draft-2020-12) for the per-hero record. Generated from src/validate.ts HeroSchema.',
    },
    patch_notes: {
      path: 'patch-notes.json',
      description: 'Structured history of Blizzard patch notes from OW2 Season 20 (2025-12-09) onward. Each patch carries a date, title, and sections of hero/general changes.',
    },
    patch_notes_schema: {
      path: 'patch-notes-schema.json',
      description: 'JSON Schema (draft-2020-12) for patch-notes.json. Generated from src/validate.ts PatchNotesDocSchema.',
    },
    attribution: {
      path: 'ATTRIBUTION.md',
      description: 'Per-hero source URLs + CC-BY-SA 3.0 share-alike notice.',
    },
    license: {
      path: 'LICENSE',
      description: 'CC-BY-SA 3.0, covering everything in data/.',
    },
    links: {
      path: 'links.md',
      description: 'Flat markdown list of every published raw URL — paste this once into Claude.ai (or any agent with a URL-allowlisted webfetch) to unlock fetches for every other file in this directory.',
    },
  };

  const usage = {
    start_here: 'data/heroes/{slug}.json',
    schema: 'data/schema.json',
    recommended_workflow: [
      'Check metadata.last_updated and metadata.heroes_failed for freshness and quality.',
      'For one hero, fetch data/heroes/{slug}.json (cheapest, self-attributed).',
      'For roster-wide queries, fetch the topical aggregate (perks.json / abilities.json / stats.json).',
      'For comparison work across all heroes, fetch all.json once.',
      'Validate any hero record against data/schema.json.',
    ],
  };

  // Absolute raw URLs for every published file. Some clients (Claude.ai's
  // webfetch in particular) only follow URLs that appear in fetched content,
  // so we publish the full list inline so a single index fetch unlocks
  // everything else. data/links.md is the markdown mirror for the same purpose.
  const links: PublishedLinks = {
    top_level: {
      index: `${PUBLISHED_RAW_BASE}/index.json`,
      heroes: `${PUBLISHED_RAW_BASE}/heroes.json`,
      perks: `${PUBLISHED_RAW_BASE}/perks.json`,
      abilities: `${PUBLISHED_RAW_BASE}/abilities.json`,
      stats: `${PUBLISHED_RAW_BASE}/stats.json`,
      all: `${PUBLISHED_RAW_BASE}/all.json`,
      schema: `${PUBLISHED_RAW_BASE}/schema.json`,
      patch_notes: `${PUBLISHED_RAW_BASE}/patch-notes.json`,
      patch_notes_schema: `${PUBLISHED_RAW_BASE}/patch-notes-schema.json`,
      attribution: `${PUBLISHED_RAW_BASE}/ATTRIBUTION.md`,
      license: `${PUBLISHED_RAW_BASE}/LICENSE`,
      links: `${PUBLISHED_RAW_BASE}/links.md`,
    },
    per_hero: Object.fromEntries(slugs.map((s) => [s, `${PUBLISHED_RAW_BASE}/heroes/${s}.json`])),
  };

  const indexDoc = {
    metadata,
    usage,
    files: indexFiles,
    links,
    heroes: rosterSorted.map((r) => ({ slug: r.slug, name: r.name, role: r.role })),
  };

  const schemaDoc = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${PUBLISHED_RAW_BASE}/schema.json`,
    title: 'Overwatch Hero',
    description: 'Schema for a single hero record as published in data/heroes/{slug}.json (under the "hero" key) and inside the "heroes" map of data/all.json.',
    metadata,
    schema: z.toJSONSchema(HeroSchema, { target: 'draft-2020-12' }),
  };

  const heroesDoc = { metadata, heroes: rosterSorted };

  const perksDoc = {
    metadata,
    heroes: Object.fromEntries(slugs.map((s) => [s, { perks: heroes[s]!.perks }])),
  };

  // Projection: descriptive subset of each ability — name + description only.
  const abilitiesDoc = {
    metadata,
    heroes: Object.fromEntries(
      slugs.map((s) => [
        s,
        {
          abilities: heroes[s]!.abilities.map((a) => ({ name: a.name, description: a.description })),
        },
      ]),
    ),
  };

  // Projection: numeric subset — health/armor/shields plus per-ability numeric
  // stats with descriptions stripped.
  const statsDoc = {
    metadata,
    heroes: Object.fromEntries(
      slugs.map((s) => {
        const h = heroes[s]!;
        return [
          s,
          {
            stats: h.stats,
            abilities: h.abilities.map((a) => {
              const { description: _d, ...rest } = a;
              void _d;
              return rest;
            }),
          },
        ];
      }),
    ),
  };

  const allDoc = {
    metadata,
    heroes: Object.fromEntries(slugs.map((s) => [s, heroes[s]!])),
  };

  const patchNotesDoc = { metadata, patches };

  const patchNotesSchemaDoc = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${PUBLISHED_RAW_BASE}/patch-notes-schema.json`,
    title: 'Overwatch Patch Notes',
    description: 'Schema for the structured patch-notes history published in data/patch-notes.json. Each patch carries a date, title, and sections of hero/general changes.',
    metadata,
    schema: z.toJSONSchema(PatchNotesDocSchema, { target: 'draft-2020-12' }),
  };

  return {
    indexDoc,
    heroesDoc,
    perksDoc,
    abilitiesDoc,
    statsDoc,
    allDoc,
    schemaDoc,
    patchNotesDoc,
    patchNotesSchemaDoc,
    links,
  };
}

export async function publish(input: PublishInput): Promise<{ paths: PublishPaths; filesWritten: string[] }> {
  const { heroes, roster, metadata, diff, dryRun, root, patches } = input;
  const paths = buildPaths(root);
  const filesWritten: string[] = [];

  const slugs = Object.keys(heroes).sort();
  const rosterSorted = [...roster].sort((a, b) => a.slug.localeCompare(b.slug));

  // Merge incoming patches with whatever's already on disk so history grows
  // monotonically as Blizzard's rolling feed cycles older patches off.
  const priorPatches = await readPreviousPatches(paths);
  const mergedPatches = mergePatches(priorPatches, patches);

  const {
    indexDoc, heroesDoc, perksDoc, abilitiesDoc, statsDoc, allDoc, schemaDoc,
    patchNotesDoc, patchNotesSchemaDoc, links,
  } = buildAggregates(heroes, roster, metadata, mergedPatches);

  if (dryRun) {
    console.log(`[dry-run] would write ${slugs.length} per-hero files + 9 top-level files + ATTRIBUTION.md + links.md`);
    return { paths, filesWritten: [] };
  }

  await mkdir(paths.dataDir, { recursive: true });
  await mkdir(paths.heroesDir, { recursive: true });

  const topLevel: Array<[string, unknown]> = [
    [join(paths.dataDir, 'index.json'), indexDoc],
    [join(paths.dataDir, 'heroes.json'), heroesDoc],
    [join(paths.dataDir, 'perks.json'), perksDoc],
    [join(paths.dataDir, 'abilities.json'), abilitiesDoc],
    [join(paths.dataDir, 'stats.json'), statsDoc],
    [join(paths.dataDir, 'all.json'), allDoc],
    [join(paths.dataDir, 'schema.json'), schemaDoc],
    [paths.patchNotesPath, patchNotesDoc],
    [join(paths.dataDir, 'patch-notes-schema.json'), patchNotesSchemaDoc],
  ];

  for (const [path, value] of topLevel) {
    await writeJson(path, value);
    filesWritten.push(path);
  }

  await clearPerHeroFiles(paths.heroesDir);
  for (const slug of slugs) {
    const path = join(paths.heroesDir, `${slug}.json`);
    const attribution = {
      fandom_page: slugToFandomUrl(slug),
      blizzard_page: slugToBlizzardUrl(slug),
    };
    await writeJson(path, { metadata, attribution, hero: heroes[slug] });
    filesWritten.push(path);
  }

  await writeAttribution(paths.attributionPath, rosterSorted, metadata);
  filesWritten.push(paths.attributionPath);

  await writeLinks(paths.linksPath, links, metadata);
  filesWritten.push(paths.linksPath);

  await prependChangelog(paths.changelogPath, diff, metadata);

  return { paths, filesWritten };
}

async function writeAttribution(path: string, roster: RosterEntry[], metadata: Metadata): Promise<void> {
  const lines: string[] = [];
  lines.push('# Attribution');
  lines.push('');
  lines.push(
    'Abilities, perks, sub-roles, and combat stats (`abilities[]` including all numeric fields, `perks.minor`, `perks.major`, `sub_role`, `stats.health`, `stats.armor`, `stats.shields`) are sourced from the [Overwatch Fandom Wiki](https://overwatch.fandom.com/) and are available under [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).',
  );
  lines.push('');
  lines.push(
    "Hero name, role, portrait, and the patch version are sourced from [Blizzard's official Overwatch site](https://overwatch.blizzard.com/en-us/heroes/). Patch-note text is also used to override Fandom values when Fandom is behind the live patch.",
  );
  lines.push('');
  lines.push(`Last generated: ${metadata.last_updated}`);
  lines.push('');
  lines.push('## Per-hero source pages');
  lines.push('');
  lines.push('| Slug | Fandom | Blizzard |');
  lines.push('|---|---|---|');
  for (const r of roster) {
    lines.push(`| ${r.slug} | ${slugToFandomUrl(r.slug)} | ${slugToBlizzardUrl(r.slug)} |`);
  }
  lines.push('');
  lines.push('## Share-alike obligation');
  lines.push('');
  lines.push(
    'Redistributing any file in this directory that contains Fandom-derived fields (effectively all of `data/`) requires preserving the CC-BY-SA 3.0 license on the redistributed content and preserving the `metadata.sources` block in each JSON file.',
  );
  lines.push('');
  await writeFile(path, lines.join('\n'), 'utf8');
}

export async function writeLinks(path: string, links: PublishedLinks, metadata: Metadata): Promise<void> {
  const lines: string[] = [];
  lines.push('# Links');
  lines.push('');
  lines.push(
    'Flat list of every published raw URL. Paste this file once into any agent with a URL-allowlisted webfetch (e.g., Claude.ai chat) to unlock fetches for every other file in `data/`.',
  );
  lines.push('');
  lines.push(`Last generated: ${metadata.last_updated}`);
  lines.push('');
  lines.push('## Top-level files');
  lines.push('');
  for (const [name, url] of Object.entries(links.top_level)) {
    lines.push(`- **${name}** — ${url}`);
  }
  lines.push('');
  lines.push('## Per-hero files');
  lines.push('');
  const slugs = Object.keys(links.per_hero).sort();
  for (const slug of slugs) {
    lines.push(`- **${slug}** — ${links.per_hero[slug]}`);
  }
  lines.push('');
  await writeFile(path, lines.join('\n'), 'utf8');
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
  if (isEmptyDiff(diff)) return;
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
