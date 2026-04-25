#!/usr/bin/env tsx
// Validates data/patch-notes.json against PatchNotesDocSchema.
// Used by the refresh-patch-notes skill before committing — fails loudly if
// the AI-authored interpretation drifts out of the published contract.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { PatchNotesDocSchema } from '../../../../src/validate.js';

async function main(): Promise<void> {
  const path = resolve(process.cwd(), process.argv[2] ?? 'data/patch-notes.json');
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const result = PatchNotesDocSchema.safeParse(parsed);
  if (!result.success) {
    console.error(`validation failed for ${path}:`);
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  const patches = (parsed as { patches: unknown[] }).patches;
  console.log(`OK — ${path} validates as PatchNotesDocSchema (${patches.length} patches)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
