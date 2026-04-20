import { describe, it, expect } from 'vitest';
// @ts-expect-error — mjs script, no type declarations
import { htmlToMarkdown } from '../../.claude/skills/process-patch-notes/scripts/fetch-blizzard-patches.mjs';

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
  <h3 class="PatchNotes-patchTitle">Overwatch Retail Patch Notes - January 1, 2024</h3>
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

describe('htmlToMarkdown', () => {
  it('emits a windowed markdown summary with hero/ability structure', () => {
    const out = htmlToMarkdown(SAMPLE_HTML, '30d', new Date('2026-04-20T00:00:00Z'));
    expect(out).toContain('# Patch Notes — window: 2026-03-21 to 2026-04-20');
    expect(out).toContain('## Overwatch Retail Patch Notes - April 17, 2026');
    expect(out).toContain('### Damage');
    expect(out).toContain('#### Cassidy');
    expect(out).toContain('- **Peacekeeper**');
    expect(out).toContain('Damage per projectile reduced from 75 to 70.');
  });

  it('filters out patches older than the --since window', () => {
    const out = htmlToMarkdown(SAMPLE_HTML, '30d', new Date('2026-04-20T00:00:00Z'));
    expect(out).not.toContain('January 1, 2024');
    expect(out).not.toContain('Old Thing');
  });

  it('accepts ISO date as --since', () => {
    const out = htmlToMarkdown(SAMPLE_HTML, '2023-01-01', new Date('2026-04-20T00:00:00Z'));
    expect(out).toContain('January 1, 2024');
    expect(out).toContain('April 17, 2026');
  });

  it('returns a placeholder when no patches fall in window', () => {
    const out = htmlToMarkdown(SAMPLE_HTML, '1d', new Date('2026-04-20T00:00:00Z'));
    expect(out).toContain('_No patches found in this window._');
  });
});
