#!/usr/bin/env node
// Fetches Blizzard's public patch-notes page and emits a date-windowed
// Markdown summary. Output is intentionally human-shaped so the skill can
// read it the way a player would.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse } from 'node-html-parser';

const PATCH_NOTES_URL = 'https://overwatch.blizzard.com/en-us/news/patch-notes/';
const USER_AGENT =
  'ow-hero-data/0.1 (jon.newton@gmail.com; +https://github.com/bluesxman/ow)';
const FETCH_TIMEOUT_MS = 20_000;

function parseArgs(argv) {
  const args = { since: '30d', out: '.run/patch-notes.md', url: PATCH_NOTES_URL };
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2];
    if (key === 'since' || key === 'out' || key === 'url') args[key] = val;
  }
  return args;
}

function resolveSince(since, now = new Date()) {
  const m = since.match(/^(\d+)d$/i);
  if (m) {
    const days = Number(m[1]);
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - days);
    return d;
  }
  const iso = new Date(since);
  if (Number.isNaN(iso.getTime())) throw new Error(`invalid --since: ${since}`);
  return iso;
}

function parsePatchDate(title) {
  // e.g. "Overwatch Retail Patch Notes - April 17, 2026"
  const m = title.match(/([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  if (!m) return null;
  const d = new Date(`${m[1]} ${m[2]}, ${m[3]} UTC`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function liText(el) {
  return el.text.replace(/\s+/g, ' ').trim();
}

export function htmlToMarkdown(html, since, now = new Date()) {
  const root = parse(html);
  const sinceDate = resolveSince(since, now);
  const patches = root.querySelectorAll('.PatchNotes-patch');
  const sections = [];
  for (const patch of patches) {
    const titleEl = patch.querySelector('.PatchNotes-patchTitle, .PatchNotes-patch-title, h3');
    const title = titleEl ? titleEl.text.trim() : '';
    const date = parsePatchDate(title);
    if (!date || date < sinceDate) continue;

    const body = [];
    body.push(`## ${title}`);

    for (const section of patch.querySelectorAll('.PatchNotes-section')) {
      const sectionTitleEl = section.querySelector('.PatchNotes-sectionTitle, h4');
      const sectionTitle = sectionTitleEl ? sectionTitleEl.text.trim() : '';
      if (!sectionTitle) continue;

      const heroUpdates = section.querySelectorAll('.PatchNotesHeroUpdate');
      const sectionBullets = section
        .querySelectorAll(':scope > .PatchNotes-sectionDescription > ul > li')
        .map(liText)
        .filter(Boolean);
      const genericUpdates = section.querySelectorAll(':scope > .PatchNotesGeneralUpdate');

      if (heroUpdates.length === 0 && sectionBullets.length === 0 && genericUpdates.length === 0) continue;

      body.push('');
      body.push(`### ${sectionTitle}`);

      for (const li of sectionBullets) body.push(`- ${li}`);

      for (const generic of genericUpdates) {
        const gtitle = generic.querySelector('.PatchNotesGeneralUpdate-title');
        const glabel = gtitle ? gtitle.text.trim() : '';
        if (glabel) {
          body.push('');
          body.push(`#### ${glabel}`);
        }
        for (const li of generic.querySelectorAll('.PatchNotesGeneralUpdate-description li')) {
          body.push(`- ${liText(li)}`);
        }
      }

      for (const hero of heroUpdates) {
        const nameEl = hero.querySelector('.PatchNotesHeroUpdate-name, h5');
        const heroName = nameEl ? nameEl.text.trim() : '';
        if (!heroName) continue;
        body.push('');
        body.push(`#### ${heroName}`);

        const generalBullets = hero
          .querySelectorAll('.PatchNotesHeroUpdate-generalUpdatesList li, .PatchNotesHeroUpdate-generalUpdates li')
          .map(liText)
          .filter(Boolean);
        for (const li of generalBullets) body.push(`- ${li}`);

        for (const ability of hero.querySelectorAll('.PatchNotesAbilityUpdate')) {
          const abNameEl = ability.querySelector('.PatchNotesAbilityUpdate-name, h6');
          const abName = abNameEl ? abNameEl.text.trim() : '';
          if (abName) body.push(`- **${abName}**`);
          for (const li of ability.querySelectorAll('li')) {
            body.push(`  - ${liText(li)}`);
          }
        }
      }
    }

    sections.push({ date, text: body.join('\n') });
  }

  sections.sort((a, b) => b.date.getTime() - a.date.getTime());

  const windowEnd = now.toISOString().slice(0, 10);
  const windowStart = sinceDate.toISOString().slice(0, 10);
  const header = `# Patch Notes — window: ${windowStart} to ${windowEnd}`;
  if (sections.length === 0) {
    return `${header}\n\n_No patches found in this window._\n`;
  }
  return `${header}\n\n${sections.map((s) => s.text).join('\n\n')}\n`;
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const html = await fetchHtml(args.url);
  const md = htmlToMarkdown(html, args.since);
  const outPath = resolve(process.cwd(), args.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, md, 'utf8');
  const lines = md.split('\n').length;
  console.log(`wrote ${outPath} (${lines} lines, since=${args.since})`);
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  main().catch((err) => {
    console.error(err?.stack ?? String(err));
    process.exit(1);
  });
}
