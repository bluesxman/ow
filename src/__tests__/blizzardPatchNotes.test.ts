import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PATCH_HISTORY_CUTOFF_DATE, parsePatchNotes } from '../sources/blizzardPatchNotes.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(here, 'fixtures/blizzard-patch-notes.html');
const HTML = readFileSync(FIXTURE_PATH, 'utf8');

describe('parsePatchNotes against captured Blizzard fixture', () => {
  const patches = parsePatchNotes(HTML);

  it('extracts at least one patch from the fixture', () => {
    expect(patches.length).toBeGreaterThan(0);
  });

  it('every patch carries an ISO date >= the history cutoff', () => {
    for (const p of patches) {
      expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.date >= PATCH_HISTORY_CUTOFF_DATE).toBe(true);
    }
  });

  it('every patch has a non-empty title and at least one section', () => {
    for (const p of patches) {
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.sections.length).toBeGreaterThan(0);
    }
  });

  it('patches are sorted newest-first', () => {
    for (let i = 1; i < patches.length; i++) {
      expect(patches[i - 1]!.date >= patches[i]!.date).toBe(true);
    }
  });

  it('hero items carry both raw name and slug', () => {
    let sawHero = false;
    for (const patch of patches) {
      for (const section of patch.sections) {
        for (const item of section.items) {
          if (item.kind === 'hero') {
            sawHero = true;
            expect(item.hero.length).toBeGreaterThan(0);
            expect(item.hero_slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
          }
        }
      }
    }
    expect(sawHero).toBe(true);
  });

  it('discriminated union — every item is hero or general, never both', () => {
    for (const patch of patches) {
      for (const section of patch.sections) {
        for (const item of section.items) {
          expect(['hero', 'general']).toContain(item.kind);
        }
      }
    }
  });

  it('cutoff is locked to OW2 Season 20 start', () => {
    expect(PATCH_HISTORY_CUTOFF_DATE).toBe('2025-12-09');
  });
});
