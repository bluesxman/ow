#!/usr/bin/env node
// For each retail quantitative change in data/patch-notes.json, compares the
// patch's claimed `to` value against the current Fandom-derived value in
// data/heroes/*.json. Surfaces drift candidates so a human can spot-check
// whether Fandom is stale or whether our patch interpretation is off.
//
// Bucketing — keep only the LATEST patch per (hero, subject) pair across ALL
// categories before bucketing. Earlier audits in the April 2026 backfill
// produced false-positive DRIFT entries by collapsing per-category, which
// preserved an old DRIFT row when a newer MATCHES row existed.
//
// Usage:
//   npm run patch-notes:audit-fandom
//   npm run patch-notes:audit-fandom -- --since=2025-12-09

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import type { Hero, PatchNotesDoc } from '../../../../src/types.js';

interface ParsedArgs {
  since?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    if (m[1] === 'since') args.since = m[2];
  }
  return args;
}

const ABILITY_METRIC_FIELDS = new Set([
  'damage',
  'cooldown',
  'duration',
  'range',
  'radius',
  'healing',
  'health',
  'shields',
  'armor',
  'ammo',
  'reload',
  'rate_of_fire',
  'movement_speed',
  'spread',
  'projectile_speed',
  'pellets',
  'cost',
  'ultimate_cost',
  'attack_speed',
  'energy',
]);

const SUPPORTED_HERO_GENERAL_METRICS = new Set(['health', 'armor', 'shields']);

function leadNum(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return null;
  const m = v.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function normalizePct(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed.endsWith('%')) return null;
  const n = Number(trimmed.slice(0, -1));
  return Number.isFinite(n) ? n : null;
}

// Lenient: equal if leading numbers match (after optional pct handling).
// Lets a bare-number patch.to match a unit-bearing Fandom string.
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const pa = normalizePct(a);
  const pb = normalizePct(b);
  if (pa !== null && pb !== null) return pa === pb;
  const na = leadNum(a);
  const nb = leadNum(b);
  if (na === null || nb === null) return false;
  return na === nb;
}

type Category = 'MATCHES' | 'STALE' | 'DRIFT' | 'N/A';

interface Row {
  cat: Category;
  patch_date: string;
  hero: string;
  subject: string;
  metric: string;
  from: unknown;
  to: unknown;
  fandom: unknown;
  raw: string;
  reason?: string;
}

function categorize(fromVal: unknown, toVal: unknown, current: unknown): Category {
  if (current === undefined) return 'N/A';
  if (valuesEqual(current, toVal)) return 'MATCHES';
  if (fromVal !== null && fromVal !== undefined && valuesEqual(current, fromVal)) {
    return 'STALE';
  }
  return 'DRIFT';
}

interface HeroFile {
  hero: Hero;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const root = resolve(process.cwd());
  const heroesDir = join(root, 'data', 'heroes');
  const docPath = join(root, 'data', 'patch-notes.json');
  const doc = JSON.parse(await readFile(docPath, 'utf8')) as PatchNotesDoc;

  const heroFiles = new Map<string, Hero>();
  const files = await readdir(heroesDir);
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const slug = f.slice(0, -5);
    const buf = await readFile(join(heroesDir, f), 'utf8');
    const parsed = JSON.parse(buf) as HeroFile;
    heroFiles.set(slug, parsed.hero);
  }

  const patches = [...doc.patches]
    .filter((p) => (args.since ? p.date >= args.since : true))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const rows: Row[] = [];
  for (const patch of patches) {
    for (const section of patch.sections) {
      for (const change of section.changes) {
        const interp = change.interpreted;
        if (interp === null) continue;
        if (interp.mode !== 'retail') continue;
        if (interp.blizzard_commentary?.some((s) => s.includes('6v6'))) continue;
        const kind = interp.subject_kind;
        if (kind !== 'ability' && kind !== 'hero_general') continue;
        if (interp.metric === null || interp.to === null) continue;
        const heroSlug = interp.hero_slug;
        if (!heroSlug) continue;
        const hero = heroFiles.get(heroSlug);
        if (!hero) continue;

        if (kind === 'hero_general') {
          if (!SUPPORTED_HERO_GENERAL_METRICS.has(interp.metric)) continue;
          const current = (hero.stats ?? {})[interp.metric as 'health' | 'armor' | 'shields'];
          const cat = categorize(interp.from, interp.to, current);
          rows.push({
            cat,
            patch_date: patch.date,
            hero: heroSlug,
            subject: `stats.${interp.metric}`,
            metric: interp.metric,
            from: interp.from,
            to: interp.to,
            fandom: current,
            raw: change.raw.text,
          });
          continue;
        }

        const abilitySlug = interp.subject_slug;
        if (!abilitySlug) continue;
        if (!ABILITY_METRIC_FIELDS.has(interp.metric)) continue;
        const ability = hero.abilities?.find((a) => a.slug === abilitySlug);
        if (!ability) {
          rows.push({
            cat: 'N/A',
            patch_date: patch.date,
            hero: heroSlug,
            subject: `${abilitySlug}.${interp.metric}`,
            metric: interp.metric,
            from: interp.from,
            to: interp.to,
            fandom: undefined,
            raw: change.raw.text,
            reason: 'ability not found',
          });
          continue;
        }
        const current = (ability as Record<string, unknown>)[interp.metric];
        const cat = categorize(interp.from, interp.to, current);
        rows.push({
          cat,
          patch_date: patch.date,
          hero: heroSlug,
          subject: `${abilitySlug}.${interp.metric}`,
          metric: interp.metric,
          from: interp.from,
          to: interp.to,
          fandom: current,
          raw: change.raw.text,
        });
      }
    }
  }

  // Collapse: keep only the most recent patch per (hero, subject) BEFORE
  // bucketing — otherwise an older DRIFT row survives next to a newer MATCHES
  // row, producing false positives.
  const latestByKey = new Map<string, Row>();
  for (const r of [...rows].sort((a, b) => (a.patch_date < b.patch_date ? -1 : 1))) {
    latestByKey.set(`${r.hero}|${r.subject}`, r);
  }

  const byCat: Record<Category, Row[]> = {
    MATCHES: [],
    STALE: [],
    DRIFT: [],
    'N/A': [],
  };
  for (const r of latestByKey.values()) byCat[r.cat].push(r);

  const sep = '='.repeat(90);
  console.log(sep);
  console.log(`TOTAL CHANGES INSPECTED: ${rows.length}`);
  console.log(`UNIQUE (hero, subject) PAIRS: ${latestByKey.size} — bucketed by their LATEST patch:`);
  console.log(`  MATCHES (Fandom up-to-date): ${byCat.MATCHES.length}`);
  console.log(`  STALE   (Fandom = patch.from — never absorbed): ${byCat.STALE.length}`);
  console.log(`  DRIFT   (Fandom = neither from nor to): ${byCat.DRIFT.length}`);
  console.log(`  N/A     (could not compare): ${byCat['N/A'].length}`);
  console.log(sep);

  const printSection = (title: string, hint: string, items: Row[]): void => {
    console.log(`\n### ${title}`);
    console.log(`(${hint})`);
    console.log('-'.repeat(90));
    items.sort((a, b) => (a.hero === b.hero ? a.subject.localeCompare(b.subject) : a.hero.localeCompare(b.hero)));
    for (const r of items) {
      console.log(`  [${r.patch_date}] ${r.hero.padEnd(18)} ${r.subject.padEnd(40)}`);
      console.log(`      patch: ${JSON.stringify(r.from)} → ${JSON.stringify(r.to)}`);
      console.log(`      fandom currently: ${JSON.stringify(r.fandom)}`);
      console.log(`      raw: ${r.raw}`);
      console.log();
    }
    console.log(`  (${items.length} unique hero+subject pairs)`);
  };

  printSection(
    'STALE — Fandom value matches patch.from (patch never absorbed)',
    'High-signal: latest patch on this field was missed by Fandom — these warrant a manual edit',
    byCat.STALE,
  );
  printSection(
    'DRIFT — Fandom value matches neither patch.from NOR patch.to',
    'Spot-check by hand. Could be: composite-string slice the audit looks past, schema-naming mismatch, multiplier vs absolute representation, hidden in a modifies[] sub-object, OR a real Fandom error',
    byCat.DRIFT,
  );

  const reportDir = resolve(process.cwd(), '.run');
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, 'fandom-audit.json');
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        rows,
        summary: {
          total_inspected: rows.length,
          unique_subjects: latestByKey.size,
          MATCHES: byCat.MATCHES.length,
          STALE: byCat.STALE.length,
          DRIFT: byCat.DRIFT.length,
          'N/A': byCat['N/A'].length,
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`\nFull report: ${reportPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
