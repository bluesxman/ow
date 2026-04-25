#!/usr/bin/env tsx
// Fetches Blizzard's public patch-notes page and emits a date-windowed Markdown
// summary at .run/patch-notes.md. The HTML parsing and markdown rendering live
// in src/sources/blizzardPatchNotes.ts so this script and the publish pipeline
// share one source of truth — change selectors there, both consumers update.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import {
  fetchAndParse,
  renderMarkdown,
  resolveSinceWindow,
} from '../../../../src/sources/blizzardPatchNotes.js';

interface ParsedArgs {
  since: string;
  out: string;
  url?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { since: '30d', out: '.run/patch-notes.md' };
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    const val = m[2]!;
    if (!val) continue;
    if (key === 'since' || key === 'out') args[key] = val;
    else if (key === 'url') args.url = val;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const fetchOpts = args.url ? { url: args.url } : {};
  const patches = await fetchAndParse(fetchOpts);
  const now = new Date();
  const windowStart = resolveSinceWindow(args.since, now);
  const windowEnd = now.toISOString().slice(0, 10);
  const md = renderMarkdown(patches, windowStart, windowEnd);
  const outPath = resolve(process.cwd(), args.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, md, 'utf8');
  const lines = md.split('\n').length;
  console.log(`wrote ${outPath} (${lines} lines, since=${args.since})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
