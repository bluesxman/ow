#!/usr/bin/env tsx
// Fetches Blizzard's patch-notes page and writes a faithful Markdown
// document at .run/patch-notes-raw.md — one section per patch, in source
// order (newest-first, post-cutoff).
//
// This is the input the refresh-patch-notes skill (Claude Code) reads to
// produce data/patch-notes.json. The deterministic layer's job is to fetch
// and convert HTML to markdown; *all* interpretation lives in the AI skill.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import {
  fetchAndRender,
  PATCH_HISTORY_CUTOFF_DATE,
  renderCombined,
} from '../../../../src/sources/blizzardPatchNotes.js';

interface ParsedArgs {
  out: string;
  url?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { out: '.run/patch-notes-raw.md' };
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
  const patches = await fetchAndRender(fetchOpts);
  const header = [
    `<!-- fetched_at: ${new Date().toISOString()} -->`,
    `<!-- cutoff_date: ${PATCH_HISTORY_CUTOFF_DATE} -->`,
    `<!-- patch_count: ${patches.length} -->`,
    '',
  ].join('\n');
  const body = renderCombined(patches);
  const outPath = resolve(process.cwd(), args.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, header + body, 'utf8');
  console.log(`wrote ${outPath} (${patches.length} patches, cutoff ${PATCH_HISTORY_CUTOFF_DATE})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
