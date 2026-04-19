import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { DATA_SOURCES, FANDOM_MAX_FAILURES_BEFORE_ISSUE, SCHEMA_VERSION } from './config.js';
import { PlaywrightHeroScraper } from './scraper/PlaywrightHeroScraper.js';
import { validateHero, checkAgainstFixture } from './validate.js';
import { diffHeroes, isEmptyDiff } from './diff.js';
import { publish, readPreviousHeroes, buildPaths } from './publish.js';
import { renderIssueBody, type RunReport } from './report.js';
import { enrichAllFromFandom } from './sources/enrichFromFandom.js';
import { logger } from './logger.js';
import type { Hero, Metadata } from './types.js';

function parseArgs(argv: string[]): { dryRun: boolean; skipFandom: boolean } {
  return {
    dryRun: argv.includes('--dry-run'),
    skipFandom: argv.includes('--skip-fandom'),
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

  const scraper = new PlaywrightHeroScraper();
  let exitCode = 0;
  try {
    logger.info('Discovering heroes…');
    const roster = await scraper.listHeroes();
    logger.info({ count: roster.length }, 'Found heroes');

    logger.info('Scraping hero pages…');
    const result = await scraper.scrapeAll(roster);
    logger.info(
      { scraped: Object.keys(result.heroes).length, failures: result.failed.length },
      'Scrape complete',
    );

    const previous = await readPreviousHeroes(paths);
    const merged: Record<string, Hero> = { ...previous };
    const validHeroes: Record<string, Hero> = {};
    for (const [slug, hero] of Object.entries(result.heroes)) {
      const v = validateHero(hero);
      if (v.ok) {
        validHeroes[slug] = v.value;
        merged[slug] = v.value;
      } else {
        logger.warn({ slug, error: v.error }, 'validation failed');
        result.failed.push({ slug, reason: `schema: ${v.error}` });
      }
    }

    let fandomFailed: Array<{ slug: string; reason: string }> = [];
    if (args.skipFandom) {
      logger.info('Skipping Fandom enrichment (--skip-fandom).');
    } else if (Object.keys(validHeroes).length === 0) {
      logger.info('No valid Blizzard-scraped heroes; skipping Fandom enrichment.');
    } else {
      logger.info({ count: Object.keys(validHeroes).length }, 'Enriching heroes from Fandom…');
      const enrichment = await enrichAllFromFandom(validHeroes);
      for (const [slug, hero] of Object.entries(enrichment.enriched)) {
        validHeroes[slug] = hero;
        merged[slug] = hero;
      }
      fandomFailed = enrichment.failed;
      logger.info(
        { enriched: Object.keys(enrichment.enriched).length, failures: fandomFailed.length },
        'Fandom enrichment complete',
      );
    }

    const fixtureCheck = await checkAgainstFixture(merged);
    if (!fixtureCheck.ok) {
      logger.error('Validation fixture mismatch — aborting publish to preserve prior data.');
      for (const m of fixtureCheck.mismatches) {
        logger.error({ slug: m.slug, tier: m.tier, expected: m.expected, got: m.got }, 'fixture mismatch');
      }
      exitCode = 2;
    }

    const diff = diffHeroes(previous, merged);

    const metadata: Metadata = {
      last_updated: new Date().toISOString(),
      patch_version: result.patchVersion,
      hero_count: Object.keys(merged).length,
      heroes_failed: result.failed.map((f) => f.slug),
      fandom_failed: fandomFailed.map((f) => f.slug),
      sources: DATA_SOURCES,
      schema_version: SCHEMA_VERSION,
    };

    if (exitCode === 0) {
      if (isEmptyDiff(diff) && !args.dryRun) {
        logger.info('No changes detected — skipping publish (idempotent).');
      } else {
        await publish({
          heroes: merged,
          roster,
          metadata,
          diff,
          dryRun: args.dryRun,
          root,
        });
        logger.info(args.dryRun ? 'Dry run complete.' : 'Published.');
      }
    }

    const report: RunReport = {
      metadata,
      diff,
      fixtureCheck,
      heroesScraped: Object.keys(validHeroes).length,
      heroesFailed: result.failed,
      fandomFailed,
      durationMs: Date.now() - started,
    };

    logger.info(
      {
        heroesScraped: report.heroesScraped,
        heroesFailed: report.heroesFailed.length,
        fandomFailed: report.fandomFailed.length,
        patchVersion: report.metadata.patch_version,
        durationMs: report.durationMs,
        fixtureOk: report.fixtureCheck.ok,
        diff: {
          added: report.diff.added.length,
          removed: report.diff.removed.length,
          changed: report.diff.changed.length,
        },
      },
      'Run summary',
    );

    if (process.env['GITHUB_OUTPUT']) {
      await writeFile(
        process.env['GITHUB_OUTPUT'],
        `heroes_scraped=${report.heroesScraped}\nheroes_failed=${report.heroesFailed.length}\nfandom_failed=${report.fandomFailed.length}\nfixture_ok=${report.fixtureCheck.ok}\ndiff_added=${report.diff.added.length}\ndiff_removed=${report.diff.removed.length}\ndiff_changed=${report.diff.changed.length}\n`,
        { flag: 'a' },
      );
    }

    const needsIssue =
      report.heroesFailed.length > 0 ||
      !report.fixtureCheck.ok ||
      report.fandomFailed.length >= FANDOM_MAX_FAILURES_BEFORE_ISSUE;
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
