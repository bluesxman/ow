// Parses Blizzard's public patch-notes page into a structured form. The same
// HTML feed serves two consumers:
//   1. The scrape pipeline, which publishes data/patch-notes.json (history).
//   2. The process-patch-notes skill, which renders a windowed markdown summary
//      to .run/patch-notes.md.
// Both go through this module so the parser is a single source of truth.

import { parse, type HTMLElement } from 'node-html-parser';
import { PATCH_NOTES_URL, USER_AGENT } from '../config.js';
import { toSlug } from '../slug.js';
import type { AbilityChange, ParsedPatch, PatchSection, PatchSectionItem } from '../types.js';

// Earliest patch we publish. Coincides with OW2 Season 20: Vendetta — the
// last season before the 2026 Overwatch rebrand. Older patches are still
// present on Blizzard's page but are intentionally dropped from output.
export const PATCH_HISTORY_CUTOFF_DATE = '2025-12-09';

const PATCH_NOTES_FETCH_TIMEOUT_MS = 20_000;

export type { AbilityChange, ParsedPatch, PatchSection, PatchSectionItem };

function liText(el: HTMLElement): string {
  return el.text.replace(/\s+/g, ' ').trim();
}

function parsePatchDate(title: string): string | null {
  // e.g. "Overwatch Retail Patch Notes - April 17, 2026"
  const m = title.match(/([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  if (!m) return null;
  const d = new Date(`${m[1]} ${m[2]}, ${m[3]} UTC`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// Parses the patch-notes HTML into structured patches, sorted newest-first.
// Drops patches before PATCH_HISTORY_CUTOFF_DATE.
export function parsePatchNotes(html: string): ParsedPatch[] {
  const root = parse(html);
  const out: ParsedPatch[] = [];

  for (const patch of root.querySelectorAll('.PatchNotes-patch')) {
    const titleEl = patch.querySelector('.PatchNotes-patchTitle, .PatchNotes-patch-title, h3');
    const title = titleEl ? titleEl.text.trim() : '';
    const date = parsePatchDate(title);
    if (!date || !title) continue;
    if (date < PATCH_HISTORY_CUTOFF_DATE) continue;

    const sections: PatchSection[] = [];

    for (const section of patch.querySelectorAll('.PatchNotes-section')) {
      const sectionTitleEl = section.querySelector('.PatchNotes-sectionTitle, h4');
      const sectionTitle = sectionTitleEl ? sectionTitleEl.text.trim() : '';
      if (!sectionTitle) continue;

      const items: PatchSectionItem[] = [];

      const sectionBullets = section
        .querySelectorAll(':scope > .PatchNotes-sectionDescription > ul > li')
        .map(liText)
        .filter((b) => b.length > 0);
      if (sectionBullets.length > 0) {
        items.push({ kind: 'general', title: '', bullets: sectionBullets });
      }

      for (const generic of section.querySelectorAll(':scope > .PatchNotesGeneralUpdate')) {
        const gtitle = generic.querySelector('.PatchNotesGeneralUpdate-title');
        const glabel = gtitle ? gtitle.text.trim() : '';
        const bullets = generic
          .querySelectorAll('.PatchNotesGeneralUpdate-description li')
          .map(liText)
          .filter((b) => b.length > 0);
        if (bullets.length === 0 && !glabel) continue;
        items.push({ kind: 'general', title: glabel, bullets });
      }

      for (const hero of section.querySelectorAll('.PatchNotesHeroUpdate')) {
        const nameEl = hero.querySelector('.PatchNotesHeroUpdate-name, h5');
        const heroName = nameEl ? nameEl.text.trim() : '';
        if (!heroName) continue;

        const heroLevel = hero
          .querySelectorAll('.PatchNotesHeroUpdate-generalUpdatesList li, .PatchNotesHeroUpdate-generalUpdates li')
          .map(liText)
          .filter((b) => b.length > 0);

        const abilities: AbilityChange[] = [];
        for (const ability of hero.querySelectorAll('.PatchNotesAbilityUpdate')) {
          const abNameEl = ability.querySelector('.PatchNotesAbilityUpdate-name, h6');
          const abName = abNameEl ? abNameEl.text.trim() : '';
          if (!abName) continue;
          const bullets = ability
            .querySelectorAll('li')
            .map(liText)
            .filter((b) => b.length > 0);
          abilities.push({ ability: abName, bullets });
        }

        if (heroLevel.length === 0 && abilities.length === 0) continue;

        items.push({
          kind: 'hero',
          hero: heroName,
          hero_slug: toSlug(heroName),
          abilities,
          hero_level: heroLevel,
        });
      }

      if (items.length === 0) continue;
      sections.push({ title: sectionTitle, items });
    }

    out.push({ date, title, sections });
  }

  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

export interface FetchOptions {
  url?: string;
  timeoutMs?: number;
}

// Fetches Blizzard's patch-notes HTML and parses it. Used by both the scrape
// pipeline (via PlaywrightHeroScraper indirectly — it already has the HTML in
// hand) and the standalone skill script.
export async function fetchAndParse(opts: FetchOptions = {}): Promise<ParsedPatch[]> {
  const url = opts.url ?? PATCH_NOTES_URL;
  const timeoutMs = opts.timeoutMs ?? PATCH_NOTES_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const html = await res.text();
    return parsePatchNotes(html);
  } finally {
    clearTimeout(timer);
  }
}

// Resolves "30d" / ISO-date / yyyy-mm-dd into an ISO yyyy-mm-dd cutoff for
// windowed markdown rendering. Used by the skill script.
export function resolveSinceWindow(since: string, now = new Date()): string {
  const m = since.match(/^(\d+)d$/i);
  if (m) {
    const days = Number(m[1]);
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  }
  const iso = new Date(since);
  if (Number.isNaN(iso.getTime())) throw new Error(`invalid since window: ${since}`);
  return iso.toISOString().slice(0, 10);
}

// Renders parsed patches as the markdown shape that .run/patch-notes.md has
// historically used. The skill's list-affected-heroes.mjs parses this exact
// shape (#### Hero, - **Ability**, nested bullets), so any change here must
// stay compatible.
export function renderMarkdown(
  patches: ParsedPatch[],
  windowStart: string,
  windowEnd: string,
): string {
  const header = `# Patch Notes — window: ${windowStart} to ${windowEnd}`;
  const inWindow = patches.filter((p) => p.date >= windowStart);
  if (inWindow.length === 0) return `${header}\n\n_No patches found in this window._\n`;

  const blocks: string[] = [];
  for (const patch of inWindow) {
    const lines: string[] = [];
    lines.push(`## ${patch.title}`);
    for (const section of patch.sections) {
      lines.push('');
      lines.push(`### ${section.title}`);
      for (const item of section.items) {
        if (item.kind === 'general') {
          if (item.title) {
            lines.push('');
            lines.push(`#### ${item.title}`);
          }
          for (const b of item.bullets) lines.push(`- ${b}`);
        } else {
          lines.push('');
          lines.push(`#### ${item.hero}`);
          for (const b of item.hero_level) lines.push(`- ${b}`);
          for (const ab of item.abilities) {
            lines.push(`- **${ab.ability}**`);
            for (const b of ab.bullets) lines.push(`  - ${b}`);
          }
        }
      }
    }
    blocks.push(lines.join('\n'));
  }
  return `${header}\n\n${blocks.join('\n\n')}\n`;
}
