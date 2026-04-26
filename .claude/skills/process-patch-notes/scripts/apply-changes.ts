#!/usr/bin/env node
// Applies retail quantitative changes from data/patch-notes.json to the
// per-hero JSONs under data/heroes/. Iterates oldest-first so newer patches
// overwrite older values on the same field (last-write-wins by time).
//
// Skip rules and safety rails encode lessons from the April 2026 backfill:
//   - composite/qualified strings ("9 seconds / -2 seconds per enemy hit",
//     "25% of damage dealt") are NOT overwritten with bare numbers — that
//     destroys information the patch never intended to remove.
//   - the patch's `from` value MUST reconcile with the existing stored value
//     before we apply `to` — otherwise Fandom has drifted to a state the patch
//     wasn't expecting and silently writing `to` would corrupt later data.
//
// Output: writes hero JSONs in place, prints a summary, and writes a JSON
// report to .run/apply-report.json with applied/skipped lists for the PR body.
//
// Usage:
//   npm run patch-notes:apply
//   npm run patch-notes:apply -- --since=2025-12-09
//   npm run patch-notes:apply -- --dry-run

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import type {
  Hero,
  PatchChangeInterpreted,
  PatchNotesDoc,
  PatchSubjectKind,
} from '../../../../src/types.js';

interface ParsedArgs {
  since?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { dryRun: false };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    const val = m[2]!;
    if (key === 'since') args.since = val;
  }
  return args;
}

const SUPPORTED_HERO_GENERAL_METRICS = new Set(['health', 'armor', 'shields']);

// Fields that exist on ability objects today. Anything outside this set is a
// schema gap — surface it rather than invent a new field.
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

function isCompositeString(val: unknown): val is string {
  return (
    typeof val === 'string' &&
    val.includes('/') &&
    (val.includes('(') || val.includes(' - '))
  );
}

// A string value carrying extra info beyond a single number+unit — rewriting
// the leading number would silently drop the qualifier (e.g. "(per pellet)",
// "of damage dealt", "per second").
function isQualifiedString(val: unknown): val is string {
  if (typeof val !== 'string') return false;
  if (val.includes('/')) return true;
  if (val.includes('(')) return true;
  if (val.includes(' - ') || val.includes(' – ')) return true;
  const lower = val.toLowerCase();
  if (lower.includes(' of ') || lower.includes(' per ')) return true;
  return false;
}

function leadNum(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return null;
  const m = v.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

// True iff the patch's `from` value reconciles with the current stored value.
// Apply only when this holds — otherwise the field has drifted from what the
// patch expected and we must not overwrite blindly.
function fromMatchesExisting(fromVal: unknown, existing: unknown): boolean {
  if (fromVal === null || fromVal === undefined) return false;
  const fNum = leadNum(fromVal);
  const eNum = leadNum(existing);
  if (fNum !== null && eNum !== null && fNum === eNum) {
    if (typeof existing === 'string') {
      // Bare-number-with-unit only — reject composites/qualifiers.
      const rest = existing.trim().split(/\s+/, 2)[1] ?? '';
      if (/[/(),]/.test(rest)) return false;
    }
    return true;
  }
  if (typeof fromVal === 'string' && typeof existing === 'string') {
    return fromVal.trim().toLowerCase() === existing.trim().toLowerCase();
  }
  return false;
}

// When existing is "9 seconds" and `to` is the bare number 12, produce
// "12 seconds" so we don't drop the unit.
function coerceToExistingFormat(toVal: unknown, existing: unknown): unknown {
  if (typeof existing === 'string' && typeof toVal === 'number') {
    const parts = existing.trim().split(/\s+/);
    if (parts.length >= 2) {
      const unit = parts.slice(1).join(' ');
      if (!/[/(),]/.test(unit)) return `${toVal} ${unit}`;
    }
  }
  return toVal;
}

interface AppliedRecord {
  patch_date: string;
  hero_slug: string;
  ability_slug: string | null;
  field: string;
  from: unknown;
  to: unknown;
  raw: string;
}

interface SkipRecord {
  patch_date: string;
  reason: string;
  raw: string;
  ctx: Record<string, unknown>;
}

interface HeroFile {
  hero: Hero;
  // Plus attribution + metadata; preserved as-is.
  [k: string]: unknown;
}

async function loadDoc(path: string): Promise<PatchNotesDoc> {
  return JSON.parse(await readFile(path, 'utf8')) as PatchNotesDoc;
}

async function loadHero(heroesDir: string, slug: string): Promise<HeroFile | null> {
  try {
    const buf = await readFile(join(heroesDir, `${slug}.json`), 'utf8');
    return JSON.parse(buf) as HeroFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function writeHero(heroesDir: string, slug: string, doc: HeroFile): Promise<void> {
  const out = JSON.stringify(doc, null, 2) + '\n';
  await writeFile(join(heroesDir, `${slug}.json`), out, 'utf8');
}

function findAbility(hero: Hero, slug: string): Hero['abilities'][number] | undefined {
  return hero.abilities?.find((a) => a.slug === slug);
}

function bcContains6v6(bc: string[] | null | undefined): boolean {
  if (!bc) return false;
  return bc.some((s) => s.includes('6v6'));
}

interface RunResult {
  applied: AppliedRecord[];
  skippedByReason: Record<string, SkipRecord[]>;
  heroesModified: string[];
}

async function run(args: ParsedArgs): Promise<RunResult> {
  const root = resolve(process.cwd());
  const heroesDir = join(root, 'data', 'heroes');
  const docPath = join(root, 'data', 'patch-notes.json');
  const doc = await loadDoc(docPath);

  const heroSlugs = new Set(
    (await readdir(heroesDir))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5)),
  );

  const patches = [...doc.patches]
    .filter((p) => (args.since ? p.date >= args.since : true))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const applied: AppliedRecord[] = [];
  const skippedByReason: Record<string, SkipRecord[]> = {};
  const dirty = new Map<string, HeroFile>();

  const skip = (reason: string, rec: SkipRecord): void => {
    (skippedByReason[reason] ??= []).push(rec);
  };

  for (const patch of patches) {
    for (const section of patch.sections) {
      for (const change of section.changes) {
        const raw = change.raw.text;
        const interp: PatchChangeInterpreted | null = change.interpreted;
        const ctx = (extra: Record<string, unknown> = {}) => ({ ...extra });
        const skipRec = (reason: string, extra: Record<string, unknown> = {}): SkipRecord => ({
          patch_date: patch.date,
          reason,
          raw,
          ctx: ctx(extra),
        });

        if (interp === null) {
          skip('uninterpretable', skipRec('uninterpretable'));
          continue;
        }
        if (interp.mode !== 'retail') {
          skip(`mode=${interp.mode}`, skipRec(`mode=${interp.mode}`));
          continue;
        }
        if (bcContains6v6(interp.blizzard_commentary)) {
          skip('6v6', skipRec('6v6 variant'));
          continue;
        }
        const kind: PatchSubjectKind = interp.subject_kind;
        if (kind === 'perk') {
          skip('perk', skipRec('perk numeric not tracked'));
          continue;
        }
        if (kind === 'system' || kind === 'map' || kind === 'role' || kind === 'unknown') {
          skip('no-hero-subject', skipRec(`no-hero-subject (${kind})`));
          continue;
        }
        if (interp.metric === null || interp.to === null) {
          skip('qualitative', skipRec('qualitative'));
          continue;
        }
        const heroSlug = interp.hero_slug;
        if (!heroSlug) {
          skip('no-hero-subject', skipRec('no hero_slug'));
          continue;
        }
        if (!heroSlugs.has(heroSlug)) {
          skip(
            'hero-not-in-roster',
            skipRec('hero not in roster', { hero_slug: heroSlug }),
          );
          continue;
        }
        let heroFile = dirty.get(heroSlug);
        if (!heroFile) {
          const loaded = await loadHero(heroesDir, heroSlug);
          if (!loaded) {
            skip(
              'hero-not-in-roster',
              skipRec('hero file missing', { hero_slug: heroSlug }),
            );
            continue;
          }
          heroFile = loaded;
        }
        const hero = heroFile.hero;
        const metric = interp.metric;

        if (kind === 'hero_general') {
          if (!SUPPORTED_HERO_GENERAL_METRICS.has(metric)) {
            skip(
              'hero-general-unsupported-metric',
              skipRec(`hero-general metric ${metric} not in stats`, {
                hero_slug: heroSlug,
                metric,
              }),
            );
            continue;
          }
          const stats = (hero.stats ??= {});
          const old = (stats as Record<string, unknown>)[metric];
          if (old === interp.to) continue;
          if (!fromMatchesExisting(interp.from, old)) {
            skip(
              'value-mismatch',
              skipRec('from-value does not match existing stat', {
                hero_slug: heroSlug,
                field: `stats.${metric}`,
                expected_from: interp.from,
                current: old,
                proposed_to: interp.to,
              }),
            );
            continue;
          }
          const newVal = coerceToExistingFormat(interp.to, old);
          (stats as Record<string, unknown>)[metric] = newVal;
          dirty.set(heroSlug, heroFile);
          applied.push({
            patch_date: patch.date,
            hero_slug: heroSlug,
            ability_slug: null,
            field: `stats.${metric}`,
            from: old,
            to: newVal,
            raw,
          });
          continue;
        }

        // kind === 'ability'
        const abilitySlug = interp.subject_slug;
        if (!abilitySlug) {
          skip(
            'ability-not-found',
            skipRec('subject_slug null', {
              hero_slug: heroSlug,
              subject_name: interp.subject_name,
            }),
          );
          continue;
        }
        const ability = findAbility(hero, abilitySlug);
        if (!ability) {
          skip(
            'ability-not-found',
            skipRec(`ability '${abilitySlug}' not found`, {
              hero_slug: heroSlug,
              subject_name: interp.subject_name,
            }),
          );
          continue;
        }
        if (!ABILITY_METRIC_FIELDS.has(metric)) {
          skip(
            'ability-metric-other',
            skipRec(`metric=${metric} not in ability schema`, {
              hero_slug: heroSlug,
              ability_slug: abilitySlug,
              metric_phrase: interp.metric_phrase,
            }),
          );
          continue;
        }
        const abilityRec = ability as Record<string, unknown>;
        if (!(metric in abilityRec)) {
          skip(
            'ability-field-missing',
            skipRec(`field '${metric}' missing on ability`, {
              hero_slug: heroSlug,
              ability_slug: abilitySlug,
              available_fields: Object.keys(abilityRec).sort(),
            }),
          );
          continue;
        }
        const old = abilityRec[metric];
        if (isCompositeString(old)) {
          skip(
            'composite-slice-ambiguity',
            skipRec('composite-string slice ambiguity', {
              hero_slug: heroSlug,
              ability_slug: abilitySlug,
              field: metric,
              current: old,
              proposed_to: interp.to,
              metric_phrase: interp.metric_phrase,
            }),
          );
          continue;
        }
        if (isQualifiedString(old)) {
          skip(
            'qualified-string-ambiguity',
            skipRec('qualified-string ambiguity (would lose info)', {
              hero_slug: heroSlug,
              ability_slug: abilitySlug,
              field: metric,
              current: old,
              proposed_to: interp.to,
              metric_phrase: interp.metric_phrase,
            }),
          );
          continue;
        }
        if (old === interp.to) continue;
        if (!fromMatchesExisting(interp.from, old)) {
          skip(
            'value-mismatch',
            skipRec('from-value does not match existing field', {
              hero_slug: heroSlug,
              ability_slug: abilitySlug,
              field: metric,
              expected_from: interp.from,
              current: old,
              proposed_to: interp.to,
              metric_phrase: interp.metric_phrase,
            }),
          );
          continue;
        }
        const newVal = coerceToExistingFormat(interp.to, old);
        abilityRec[metric] = newVal;
        dirty.set(heroSlug, heroFile);
        applied.push({
          patch_date: patch.date,
          hero_slug: heroSlug,
          ability_slug: abilitySlug,
          field: metric,
          from: old,
          to: newVal,
          raw,
        });
      }
    }
  }

  if (!args.dryRun) {
    for (const [slug, file] of dirty.entries()) {
      await writeHero(heroesDir, slug, file);
    }
  }

  return {
    applied,
    skippedByReason,
    heroesModified: [...dirty.keys()].sort(),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const result = await run(args);
  const totalSkipped = Object.values(result.skippedByReason).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );

  console.log(`${args.dryRun ? '[dry-run] ' : ''}Applied ${result.applied.length} changes across ${result.heroesModified.length} heroes`);
  console.log(`Skipped ${totalSkipped} changes`);
  console.log('Skip breakdown:');
  for (const [reason, recs] of Object.entries(result.skippedByReason).sort()) {
    console.log(`  ${reason}: ${recs.length}`);
  }

  const reportDir = resolve(process.cwd(), '.run');
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, 'apply-report.json');
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        applied: result.applied,
        applied_count: result.applied.length,
        heroes_modified: result.heroesModified,
        heroes_modified_count: result.heroesModified.length,
        skipped_by_reason: result.skippedByReason,
        skipped_total: totalSkipped,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`Report: ${reportPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
