import { describe, it, expect } from 'vitest';
import {
  PATCH_HISTORY_CUTOFF_DATE,
  parsePatchNotes,
  renderMarkdown,
  resolveSinceWindow,
} from '../sources/blizzardPatchNotes.js';

const SAMPLE_HTML = `
<html><body>
<div class="PatchNotes-patch">
  <h3 class="PatchNotes-patchTitle">Overwatch Retail Patch Notes - April 17, 2026</h3>
  <div class="PatchNotes-section">
    <h4 class="PatchNotes-sectionTitle">Damage</h4>
    <div class="PatchNotesHeroUpdate">
      <h5 class="PatchNotesHeroUpdate-name">Cassidy</h5>
      <div class="PatchNotesAbilityUpdate">
        <h6 class="PatchNotesAbilityUpdate-name">Peacekeeper</h6>
        <ul><li>Damage per projectile reduced from 75 to 70.</li></ul>
      </div>
    </div>
  </div>
</div>
<div class="PatchNotes-patch">
  <h3 class="PatchNotes-patchTitle">Overwatch 2 Retail Patch Notes - December 9, 2025</h3>
  <div class="PatchNotes-section">
    <h4 class="PatchNotes-sectionTitle">Damage</h4>
    <div class="PatchNotesHeroUpdate">
      <h5 class="PatchNotesHeroUpdate-name">Reaper</h5>
      <div class="PatchNotesAbilityUpdate">
        <h6 class="PatchNotesAbilityUpdate-name">Hellfire Shotguns</h6>
        <ul><li>Reload time reduced.</li></ul>
      </div>
    </div>
  </div>
</div>
<div class="PatchNotes-patch">
  <h3 class="PatchNotes-patchTitle">Overwatch 2 Retail Patch Notes - January 1, 2024</h3>
  <div class="PatchNotes-section">
    <h4 class="PatchNotes-sectionTitle">Damage</h4>
    <div class="PatchNotesHeroUpdate">
      <h5 class="PatchNotesHeroUpdate-name">Ancient</h5>
      <div class="PatchNotesAbilityUpdate">
        <h6 class="PatchNotesAbilityUpdate-name">Old Thing</h6>
        <ul><li>Ignore me.</li></ul>
      </div>
    </div>
  </div>
</div>
</body></html>
`;

describe('parsePatchNotes', () => {
  it('extracts patches with date and structured items, sorted newest-first', () => {
    const patches = parsePatchNotes(SAMPLE_HTML);
    expect(patches.map((p) => p.date)).toEqual(['2026-04-17', '2025-12-09']);
    const cassidy = patches[0]!.sections[0]!.items[0]!;
    expect(cassidy.kind).toBe('hero');
    if (cassidy.kind === 'hero') {
      expect(cassidy.hero).toBe('Cassidy');
      expect(cassidy.hero_slug).toBe('cassidy');
      expect(cassidy.abilities[0]).toEqual({
        ability: 'Peacekeeper',
        bullets: ['Damage per projectile reduced from 75 to 70.'],
      });
    }
  });

  it('drops patches before the history cutoff', () => {
    const patches = parsePatchNotes(SAMPLE_HTML);
    expect(patches.find((p) => p.date.startsWith('2024'))).toBeUndefined();
    expect(PATCH_HISTORY_CUTOFF_DATE).toBe('2025-12-09');
  });
});

describe('renderMarkdown', () => {
  const patches = parsePatchNotes(SAMPLE_HTML);

  it('emits the windowed markdown shape the skill consumes', () => {
    const md = renderMarkdown(patches, '2026-03-21', '2026-04-20');
    expect(md).toContain('# Patch Notes — window: 2026-03-21 to 2026-04-20');
    expect(md).toContain('## Overwatch Retail Patch Notes - April 17, 2026');
    expect(md).toContain('### Damage');
    expect(md).toContain('#### Cassidy');
    expect(md).toContain('- **Peacekeeper**');
    expect(md).toContain('Damage per projectile reduced from 75 to 70.');
  });

  it('filters by window in addition to the parse-time cutoff', () => {
    const md = renderMarkdown(patches, '2026-03-21', '2026-04-20');
    expect(md).not.toContain('December 9, 2025');
  });

  it('returns a placeholder when no patches fall in window', () => {
    const md = renderMarkdown(patches, '2026-04-19', '2026-04-20');
    expect(md).toContain('_No patches found in this window._');
  });
});

describe('resolveSinceWindow', () => {
  it('resolves Nd offsets relative to now', () => {
    const cutoff = resolveSinceWindow('30d', new Date('2026-04-20T00:00:00Z'));
    expect(cutoff).toBe('2026-03-21');
  });

  it('accepts ISO dates verbatim', () => {
    const cutoff = resolveSinceWindow('2026-01-15', new Date('2026-04-20T00:00:00Z'));
    expect(cutoff).toBe('2026-01-15');
  });
});
