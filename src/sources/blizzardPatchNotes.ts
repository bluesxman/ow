// Fetches Blizzard's public patch-notes page and emits a Markdown document.
//
// Design choice: the only deterministic concern here is identifying patch
// boundaries (date + title) and applying the post-2025-12-09 cutoff. Inside
// each patch we do a faithful HTML→Markdown pass that preserves *whatever*
// section/hero/ability structure Blizzard published — without trying to
// classify items into hero vs. general buckets. That classification work
// belongs to the AI layer (the refresh-patch-notes skill), which interprets
// the markdown and writes data/patch-notes.json.
//
// Why not pre-classify here? Blizzard's HTML structure shifts (April 23, 2026
// hotfix split a single logical section into two sibling DOM blocks; that
// silently dropped Roadhog/Sombra/Vendetta balance changes from the old
// pre-classifying parser). The fewer pattern-matches we hard-code, the less
// likely a layout shift makes us silently lose data. Faithful markdown is
// strictly more information than pre-classified JSON.

import { parse, type HTMLElement, type Node } from 'node-html-parser';
import { PATCH_NOTES_ARCHIVE_BASE, PATCH_NOTES_URL, USER_AGENT } from '../config.js';

// Earliest patch we publish. Coincides with OW2 Season 20: Vendetta — the
// last season before the 2026 Overwatch rebrand. Older patches are still
// present on Blizzard's page but are intentionally dropped from output.
export const PATCH_HISTORY_CUTOFF_DATE = '2025-12-09';

const PATCH_NOTES_FETCH_TIMEOUT_MS = 20_000;

export interface PatchMarkdown {
  date: string; // ISO yyyy-mm-dd
  title: string;
  markdown: string; // body rendered as markdown, no leading title heading
}

function parsePatchDate(title: string): string | null {
  // e.g. "Overwatch Retail Patch Notes - April 17, 2026"
  const m = title.match(/([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  if (!m) return null;
  const d = new Date(`${m[1]} ${m[2]}, ${m[3]} UTC`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function isHTMLElement(n: Node): n is HTMLElement {
  return (n as HTMLElement).tagName !== undefined;
}

// Inline conversion: walk children producing a single line of text with
// minimal inline formatting (bold, emphasis, links, line breaks). Whitespace
// is collapsed except for line breaks.
function renderInline(el: HTMLElement): string {
  const parts: string[] = [];
  for (const child of el.childNodes) {
    if (!isHTMLElement(child)) {
      parts.push(child.text);
      continue;
    }
    const tag = child.tagName?.toLowerCase() ?? '';
    switch (tag) {
      case 'br':
        parts.push('\n');
        break;
      case 'strong':
      case 'b':
        parts.push(`**${renderInline(child)}**`);
        break;
      case 'em':
      case 'i':
        parts.push(`*${renderInline(child)}*`);
        break;
      case 'a': {
        const href = child.getAttribute('href') ?? '';
        const text = renderInline(child);
        parts.push(href ? `[${text}](${href})` : text);
        break;
      }
      case 'code':
        parts.push(`\`${renderInline(child)}\``);
        break;
      default:
        parts.push(renderInline(child));
        break;
    }
  }
  return parts.join('').replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
}

// Block conversion: walk an element's children producing markdown blocks,
// each separated by blank lines. Lists are rendered with two-space-indented
// sub-bullets so nested ULs/OLs are preserved. Heading levels are mapped
// 1:1 from h1..h6 — this preserves the document hierarchy verbatim.
function renderBlocks(el: HTMLElement, indent: number = 0): string[] {
  const out: string[] = [];
  const pad = '  '.repeat(indent);

  for (const child of el.childNodes) {
    if (!isHTMLElement(child)) {
      const text = child.text.trim();
      if (text) out.push(pad + text.replace(/\s+/g, ' '));
      continue;
    }
    const tag = child.tagName?.toLowerCase() ?? '';
    switch (tag) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        const level = Number(tag[1]);
        const text = renderInline(child);
        if (text) out.push(`${'#'.repeat(level)} ${text}`);
        break;
      }
      case 'p': {
        const text = renderInline(child);
        if (text) out.push(pad + text);
        break;
      }
      case 'ul':
      case 'ol': {
        let i = 1;
        for (const li of child.querySelectorAll(':scope > li')) {
          const marker = tag === 'ol' ? `${i}.` : '-';
          // First, render the immediate inline content of the li (text +
          // inline tags before any nested block-level element).
          const inlineFragments: string[] = [];
          const blockTail: HTMLElement[] = [];
          let seenBlock = false;
          for (const sub of li.childNodes) {
            if (!isHTMLElement(sub)) {
              if (!seenBlock) inlineFragments.push(sub.text);
              continue;
            }
            const subTag = sub.tagName?.toLowerCase() ?? '';
            if (
              subTag === 'ul' ||
              subTag === 'ol' ||
              subTag === 'p' ||
              subTag === 'div' ||
              /^h[1-6]$/.test(subTag)
            ) {
              seenBlock = true;
              blockTail.push(sub);
            } else if (!seenBlock) {
              // Inline child — render via a synthetic wrapper.
              const wrapped = parse(`<span>${sub.outerHTML ?? sub.toString()}</span>`).querySelector('span');
              if (wrapped) inlineFragments.push(renderInline(wrapped));
            }
          }
          const head = inlineFragments.join('').replace(/\s+/g, ' ').trim();
          out.push(`${pad}${marker} ${head}`);
          for (const block of blockTail) {
            const sub = renderBlocks(block, indent + 1);
            for (const s of sub) out.push(s);
          }
          i++;
        }
        break;
      }
      case 'br':
        // Standalone <br> at block scope — ignore.
        break;
      case 'img':
      case 'svg':
      case 'figure':
      case 'picture':
        // Decorative; drop entirely.
        break;
      case 'div':
      case 'section':
      case 'article':
      case 'aside':
      case 'header':
      case 'footer':
      case 'main':
      case 'nav': {
        // Recurse into structural containers without emitting anything for
        // the wrapper itself.
        const sub = renderBlocks(child, indent);
        for (const s of sub) out.push(s);
        break;
      }
      default: {
        // Unknown tag — try inline rendering. If it produces text, emit
        // as its own line; otherwise recurse.
        const inlineText = renderInline(child);
        if (inlineText) {
          out.push(pad + inlineText);
        } else {
          const sub = renderBlocks(child, indent);
          for (const s of sub) out.push(s);
        }
        break;
      }
    }
  }
  return out;
}

function htmlToMarkdown(el: HTMLElement): string {
  const blocks = renderBlocks(el).map((b) => b.replace(/\s+$/g, '')).filter((b) => b.length > 0);
  return blocks.join('\n\n').trim();
}

// Parses the patch-notes HTML into per-patch markdown documents, sorted
// newest-first. Drops patches before PATCH_HISTORY_CUTOFF_DATE.
export function parsePatchNotesMarkdown(html: string): PatchMarkdown[] {
  const root = parse(html);
  const out: PatchMarkdown[] = [];

  for (const patch of root.querySelectorAll('.PatchNotes-patch')) {
    const titleEl = patch.querySelector('.PatchNotes-patchTitle, .PatchNotes-patch-title, h3');
    const title = titleEl ? titleEl.text.trim() : '';
    const date = parsePatchDate(title);
    if (!date || !title) continue;
    if (date < PATCH_HISTORY_CUTOFF_DATE) continue;

    // Render everything inside the patch container *except* the patch title
    // itself — we surface the title separately so the caller controls the
    // top-level heading level in the combined document.
    if (titleEl) titleEl.remove();
    const markdown = htmlToMarkdown(patch);

    out.push({ date, title, markdown });
  }

  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

export interface FetchOptions {
  url?: string;
  timeoutMs?: number;
}

export async function fetchPatchHtml(opts: FetchOptions = {}): Promise<string> {
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
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Enumerate "YYYY-MM" strings from `from` (inclusive) up to and including
// `to`. Both arguments are ISO `YYYY-MM-DD`; only the year/month are read.
export function monthsBetween(from: string, to: string): string[] {
  const [fy, fm] = from.split('-').map(Number) as [number, number, ...unknown[]];
  const [ty, tm] = to.split('-').map(Number) as [number, number, ...unknown[]];
  const out: string[] = [];
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

// Build the Blizzard URL for one month's archive. Trailing slash matters —
// without it the server 307s and only some clients follow.
export function patchArchiveUrl(yearMonth: string): string {
  const [y, m] = yearMonth.split('-');
  return `${PATCH_NOTES_ARCHIVE_BASE}/${y}/${m}/`;
}

export interface FetchAllOptions {
  // Override the "today" anchor used to compute the last archive month.
  // Defaults to the current UTC date. Useful for tests.
  asOfDate?: string;
  timeoutMs?: number;
  // Override the cutoff (defaults to PATCH_HISTORY_CUTOFF_DATE). Useful for
  // tests that want to walk a smaller window.
  cutoffDate?: string;
}

// Fetches every monthly patch-notes archive from the cutoff month through the
// current month, parses each, and returns deduplicated patches sorted
// newest-first. Blizzard's landing page only renders the most recent few
// patches, so older patches require walking per-month archive URLs at
// /news/patch-notes/live/YYYY/MM/. Errors on individual months are logged
// and skipped — losing one month is preferable to losing the entire run.
export async function fetchAndRenderAll(opts: FetchAllOptions = {}): Promise<PatchMarkdown[]> {
  const cutoff = opts.cutoffDate ?? PATCH_HISTORY_CUTOFF_DATE;
  const asOf = opts.asOfDate ?? new Date().toISOString().slice(0, 10);
  const timeoutMs = opts.timeoutMs ?? PATCH_NOTES_FETCH_TIMEOUT_MS;

  const months = monthsBetween(cutoff, asOf);
  const byDate = new Map<string, PatchMarkdown>();

  for (const ym of months) {
    const url = patchArchiveUrl(ym);
    try {
      const html = await fetchPatchHtml({ url, timeoutMs });
      for (const patch of parsePatchNotesMarkdown(html)) {
        if (!byDate.has(patch.date)) byDate.set(patch.date, patch);
      }
    } catch (err) {
      console.warn(`patch-notes archive ${ym} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const out = Array.from(byDate.values());
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

export async function fetchAndRender(opts: FetchOptions = {}): Promise<PatchMarkdown[]> {
  const html = await fetchPatchHtml(opts);
  return parsePatchNotesMarkdown(html);
}

// Render a list of per-patch markdown blobs as one document. Each patch is
// introduced with `# <title>` so AI consumers see clear patch boundaries.
export function renderCombined(patches: PatchMarkdown[]): string {
  if (patches.length === 0) return '_No patches found._\n';
  const blocks: string[] = [];
  for (const p of patches) {
    blocks.push(`# ${p.title}\n\n${p.markdown}`);
  }
  return blocks.join('\n\n---\n\n') + '\n';
}
