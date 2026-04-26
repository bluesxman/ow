import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  PATCH_HISTORY_CUTOFF_DATE,
  monthsBetween,
  parsePatchNotesMarkdown,
  patchArchiveUrl,
  renderCombined,
} from '../sources/blizzardPatchNotes.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(here, 'fixtures/blizzard-patch-notes.html');
const HTML = readFileSync(FIXTURE_PATH, 'utf8');

describe('parsePatchNotesMarkdown against captured Blizzard fixture', () => {
  const patches = parsePatchNotesMarkdown(HTML);

  it('extracts at least one patch from the fixture', () => {
    expect(patches.length).toBeGreaterThan(0);
  });

  it('every patch carries an ISO date >= the history cutoff', () => {
    for (const p of patches) {
      expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.date >= PATCH_HISTORY_CUTOFF_DATE).toBe(true);
    }
  });

  it('every patch has a non-empty title and non-empty markdown', () => {
    for (const p of patches) {
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.markdown.length).toBeGreaterThan(0);
    }
  });

  it('patches are sorted newest-first', () => {
    for (let i = 1; i < patches.length; i++) {
      expect(patches[i - 1]!.date >= patches[i]!.date).toBe(true);
    }
  });

  it('cutoff is locked to OW2 Season 20 start', () => {
    expect(PATCH_HISTORY_CUTOFF_DATE).toBe('2025-12-09');
  });

  // Regression test for the April 23, 2026 hotfix: the previous
  // pre-classifying parser silently dropped "Hero Balance Updates" because
  // Blizzard split the heading and the hero cards into two sibling DOM
  // sections. The faithful HTML→Markdown converter must surface every
  // hero/ability mentioned on the live page.
  it('preserves all April 23, 2026 retail balance changes', () => {
    const apr23 = patches.find((p) => p.date === '2026-04-23');
    expect(apr23, 'expected April 23 patch in fixture').toBeDefined();
    const md = apr23!.markdown;

    expect(md).toContain('Hero Balance Updates');

    expect(md).toContain('Roadhog');
    expect(md).toContain('Chain Hook');
    expect(md).toMatch(/Cooldown reduced from 8 to 7 seconds/);

    expect(md).toContain('Sombra');
    expect(md).toContain('Stealth');

    expect(md).toContain('Vendetta');
    expect(md).toMatch(/[Hh]ealth/);
  });

  it('preserves hero/ability hierarchy as nested headings', () => {
    const apr23 = patches.find((p) => p.date === '2026-04-23');
    expect(apr23).toBeDefined();
    const md = apr23!.markdown;
    // Hero names appear as h5 in Blizzard's HTML — should map to ##### in
    // our markdown.
    expect(md).toMatch(/##### Roadhog/);
  });

  it('preserves Stadium hero updates as a distinct section', () => {
    const apr23 = patches.find((p) => p.date === '2026-04-23');
    expect(apr23).toBeDefined();
    const md = apr23!.markdown;
    expect(md).toContain('Stadium Hero Updates');
  });
});

describe('renderCombined', () => {
  const patches = parsePatchNotesMarkdown(HTML);

  it('emits a single document with one heading per patch', () => {
    const doc = renderCombined(patches);
    for (const p of patches) {
      expect(doc).toContain(`# ${p.title}`);
    }
  });

  it('separates patches with a horizontal rule', () => {
    const doc = renderCombined(patches);
    if (patches.length > 1) {
      expect(doc).toContain('\n---\n');
    }
  });

  it('returns a placeholder when given no patches', () => {
    const doc = renderCombined([]);
    expect(doc).toContain('_No patches found._');
  });
});

describe('monthsBetween', () => {
  it('enumerates months inclusive of both endpoints', () => {
    expect(monthsBetween('2025-12-09', '2026-04-23')).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
    ]);
  });

  it('handles same-month input', () => {
    expect(monthsBetween('2026-04-01', '2026-04-30')).toEqual(['2026-04']);
  });

  it('crosses year boundaries', () => {
    expect(monthsBetween('2025-11-01', '2026-02-15')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('handles a multi-year span', () => {
    const months = monthsBetween('2024-10-01', '2026-01-15');
    expect(months[0]).toBe('2024-10');
    expect(months[months.length - 1]).toBe('2026-01');
    expect(months.length).toBe(16);
  });
});

describe('patchArchiveUrl', () => {
  it('builds a trailing-slash URL — required to avoid the 307 redirect', () => {
    expect(patchArchiveUrl('2026-04')).toBe(
      'https://overwatch.blizzard.com/en-us/news/patch-notes/live/2026/04/',
    );
  });

  it('preserves the zero-padded month', () => {
    expect(patchArchiveUrl('2026-01')).toBe(
      'https://overwatch.blizzard.com/en-us/news/patch-notes/live/2026/01/',
    );
  });
});
