import type { HeroDiff } from './diff.js';
import type { FixtureCheckResult } from './validate.js';
import type { Metadata } from './types.js';

export interface RunReport {
  metadata: Metadata;
  diff: HeroDiff;
  fixtureCheck: FixtureCheckResult;
  heroesScraped: number;
  heroesFailed: Array<{ slug: string; reason: string }>;
  fandomFailed: Array<{ slug: string; reason: string }>;
  durationMs: number;
}

export function renderConsole(report: RunReport): string {
  const lines: string[] = [];
  lines.push(`Heroes scraped: ${report.heroesScraped}`);
  lines.push(`Heroes failed: ${report.heroesFailed.length}`);
  for (const f of report.heroesFailed) lines.push(`  - ${f.slug}: ${f.reason}`);
  lines.push(`Fandom failed: ${report.fandomFailed.length}`);
  for (const f of report.fandomFailed) lines.push(`  - ${f.slug}: ${f.reason}`);
  lines.push(`Patch: ${report.metadata.patch_version}`);
  lines.push(`Duration: ${(report.durationMs / 1000).toFixed(1)}s`);
  lines.push(`Fixture check: ${report.fixtureCheck.ok ? 'OK' : 'MISMATCH'}`);
  for (const m of report.fixtureCheck.mismatches) {
    lines.push(`  - ${m.slug} ${m.tier}: expected [${m.expected.join(', ')}] got [${m.got.join(', ')}]`);
  }
  lines.push(`Diff: +${report.diff.added.length} -${report.diff.removed.length} ~${report.diff.changed.length}`);
  return lines.join('\n');
}

export function renderIssueBody(report: RunReport): string {
  const lines: string[] = [];
  lines.push(`## Scrape run ${report.metadata.last_updated}`);
  lines.push('');
  if (report.heroesFailed.length) {
    lines.push(`### Failed heroes (fell back to prior data)`);
    for (const f of report.heroesFailed) lines.push(`- **${f.slug}** — ${f.reason}`);
    lines.push('');
  }
  if (report.fandomFailed.length) {
    lines.push(`### Fandom enrichment failures (Blizzard data still published)`);
    for (const f of report.fandomFailed) lines.push(`- **${f.slug}** — ${f.reason}`);
    lines.push('');
  }
  if (!report.fixtureCheck.ok) {
    lines.push(`### Validation fixture MISMATCH (publish aborted)`);
    for (const m of report.fixtureCheck.mismatches) {
      lines.push(`- ${m.slug} ${m.tier}: expected \`[${m.expected.join(', ')}]\` got \`[${m.got.join(', ')}]\``);
    }
    lines.push('');
    lines.push(`If Blizzard legitimately renamed a perk, update \`src/__tests__/fixtures/validation.json\` and re-run. This is a deliberate human checkpoint.`);
    lines.push('');
  }
  lines.push(`Patch version: \`${report.metadata.patch_version}\``);
  return lines.join('\n');
}
