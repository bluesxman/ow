#!/usr/bin/env tsx
// Fetches Blizzard's patch-notes page, runs the deterministic parser, and
// writes the raw structured output to .run/patch-notes-raw.json. This is the
// input the refresh-patch-notes skill (Claude Code) reads to produce the
// final, AI-interpreted data/patch-notes.json.
//
// Intentionally does no interpretation — mode/subject/metric inference belongs
// to the AI, not deterministic code.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fetchAndParse, PATCH_HISTORY_CUTOFF_DATE } from '../../../../src/sources/blizzardPatchNotes.js';

interface ParsedArgs {
  out: string;
  url?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { out: '.run/patch-notes-raw.json' };
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    const val = m[2]!;
    if (!val) continue;
    if (key === 'out') args.out = val;
    else if (key === 'url') args.url = val;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const fetchOpts = args.url ? { url: args.url } : {};
  const patches = await fetchAndParse(fetchOpts);
  const outPath = resolve(process.cwd(), args.out);
  await mkdir(dirname(outPath), { recursive: true });
  const body = {
    fetched_at: new Date().toISOString(),
    cutoff_date: PATCH_HISTORY_CUTOFF_DATE,
    patches,
  };
  await writeFile(outPath, JSON.stringify(body, null, 2) + '\n', 'utf8');
  console.log(`wrote ${outPath} (${patches.length} patches, cutoff ${PATCH_HISTORY_CUTOFF_DATE})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
