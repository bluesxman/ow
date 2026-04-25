import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { DATA_SOURCES, SCHEMA_VERSION } from './config.js';
import { PlaywrightHeroScraper } from './scraper/PlaywrightHeroScraper.js';
import { validateHero, checkAgainstFixture } from './validate.js';
import { diffHeroes } from './diff.js';
import { publish, readPreviousHeroes, buildPaths } from './publish.js';
import { renderConsole, renderIssueBody, type RunReport } from './report.js';
import { defaultCacheRoot, FsDiskCache, NoopCache, type DiskCache } from './cache/diskCache.js';
import type { Hero, Metadata } from './types.js';

function parseArgs(argv: string[]): {
  dryRun: boolean;
  cache: boolean;
  hero: string | null;
} {
  let hero: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--hero' && argv[i + 1]) {
      hero = argv[i + 1]!;
      i++;
    } else if (a.startsWith('--hero=')) {
      hero = a.slice('--hero='.length);
    }
  }
  return {
    dryRun: argv.includes('--dry-run'),
    cache: argv.includes('--cache'),
    hero,
  };
}

function projectRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..');
}

async function main(): Promise<void> {
  const started = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const root = projectRoot();
  const paths = buildPaths(root);

  const cache: DiskCache = args.cache ? new FsDiskCache(defaultCacheRoot(root)) : new NoopCache();
  if (args.cache) console.log(`Local cache enabled at ${defaultCacheRoot(root)}`);
  if (args.hero) console.log(`Single-hero mode: ${args.hero}`);
  const scraper = new PlaywrightHeroScraper(cache);
  let exitCode = 0;
  try {
    console.log('Discovering heroes via Blizzard roster…');
    const fullRoster = await scraper.listHeroes();
    const roster = args.hero ? fullRoster.filter((r) => r.slug === args.hero) : fullRoster;
    if (args.hero && roster.length === 0) {
      throw new Error(`--hero ${args.hero} not found in roster of ${fullRoster.length} heroes`);
    }
    console.log(`Found ${fullRoster.length} heroes${args.hero ? ` (filtered to 1)` : ''}`);

    console.log('Fetching hero data from Fandom…');
    const result = await scraper.scrapeAll(roster);
    console.log(`Fetched ${Object.keys(result.heroes).length} heroes, ${result.failed.length} failures`);

    const previous = await readPreviousHeroes(paths);
    const merged: Record<string, Hero> = { ...previous };
    const validHeroes: Record<string, Hero> = {};
    for (const [slug, hero] of Object.entries(result.heroes)) {
      const v = validateHero(hero);
      if (v.ok) {
        validHeroes[slug] = v.value;
        merged[slug] = v.value;
      } else {
        console.warn(`validation failed for ${slug}: ${v.error}`);
        result.failed.push({ slug, reason: `schema: ${v.error}` });
      }
    }

    const fixtureCheck = await checkAgainstFixture(merged);
    if (!fixtureCheck.ok) {
      console.error('Validation fixture mismatch — aborting publish to preserve prior data.');
      for (const m of fixtureCheck.mismatches) {
        console.error(`  ${m.slug} ${m.tier}: expected [${m.expected.join(', ')}] got [${m.got.join(', ')}]`);
      }
      exitCode = 2;
    }

    const diff = diffHeroes(previous, merged);

    const metadata: Metadata = {
      last_updated: new Date().toISOString(),
      patch_version: result.patchVersion,
      hero_count: Object.keys(merged).length,
      heroes_failed: result.failed.map((f) => f.slug),
      fandom_failed: [],
      sources: DATA_SOURCES,
      schema_version: SCHEMA_VERSION,
    };

    if (exitCode === 0) {
      await publish({
        heroes: merged,
        roster: fullRoster,
        metadata,
        diff,
        dryRun: args.dryRun,
        root,
      });
      console.log(args.dryRun ? 'Dry run complete.' : 'Published.');
    }

    const report: RunReport = {
      metadata,
      diff,
      fixtureCheck,
      heroesScraped: Object.keys(validHeroes).length,
      heroesFailed: result.failed,
      fandomFailed: [],
      durationMs: Date.now() - started,
    };

    console.log('\n' + renderConsole(report));

    if (process.env['GITHUB_OUTPUT']) {
      await writeFile(
        process.env['GITHUB_OUTPUT'],
        `heroes_scraped=${report.heroesScraped}\nheroes_failed=${report.heroesFailed.length}\nfandom_failed=${report.fandomFailed.length}\nfixture_ok=${report.fixtureCheck.ok}\ndiff_added=${report.diff.added.length}\ndiff_removed=${report.diff.removed.length}\ndiff_changed=${report.diff.changed.length}\n`,
        { flag: 'a' },
      );
    }

    const needsIssue = report.heroesFailed.length > 0 || !report.fixtureCheck.ok;
    if (needsIssue) {
      await mkdir(resolve(root, '.run'), { recursive: true });
      await writeFile(resolve(root, '.run/issue-body.md'), renderIssueBody(report), 'utf8');
    }
  } finally {
    await scraper.close();
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
