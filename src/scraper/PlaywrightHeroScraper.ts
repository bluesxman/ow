import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  BASE_URL,
  HEROES_INDEX_URL,
  HERO_LIST_TIMEOUT_MS,
  HERO_PAGE_TIMEOUT_MS,
  MAX_HERO_FAILURES_BEFORE_ABORT,
  MIN_EXPECTED_HEROES,
  NAV_TIMEOUT_MS,
  PATCH_NOTES_URL,
  USER_AGENT,
} from '../config.js';
import { normalizeDescription, normalizeName, normalizeRole } from '../normalize.js';
import { isValidSlug, toSlug } from '../slug.js';
import type { Ability, Hero, HeroStats, Perk, RosterEntry, Role, ScrapeResult } from '../types.js';
import type { HeroScraper } from './HeroScraper.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTRACTOR_SOURCE = readFileSync(resolve(HERE, 'extractor.js'), 'utf8');
const LIST_EXTRACTOR_SOURCE = readFileSync(resolve(HERE, 'listExtractor.js'), 'utf8');
const PATCH_EXTRACTOR_SOURCE = readFileSync(resolve(HERE, 'patchExtractor.js'), 'utf8');

interface RawListEntry {
  slug: string;
  name: string;
  role: string | null;
  portrait: string | null;
}

interface ExtractionResult {
  perks: { minor: Array<{ name: string; description: string }>; major: Array<{ name: string; description: string }> };
  abilities: Array<{ name: string; description: string }>;
  role: string;
  stats: { health?: number; armor?: number; shields?: number };
  markers: { perksIdx: number; stadiumIdx: number; abilitiesIdx: number };
}

export class PlaywrightHeroScraper implements HeroScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  async init(): Promise<void> {
    if (this.browser) return;
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      userAgent: USER_AGENT,
      locale: 'en-US',
      viewport: { width: 1440, height: 900 },
    });
    this.context.setDefaultTimeout(HERO_PAGE_TIMEOUT_MS);
    this.context.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  }

  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
    this.context = null;
    this.browser = null;
  }

  private async newPage(): Promise<Page> {
    if (!this.context) throw new Error('Scraper not initialized');
    return this.context.newPage();
  }

  async listHeroes(): Promise<RosterEntry[]> {
    await this.init();
    const page = await this.newPage();
    try {
      await page.goto(HEROES_INDEX_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: HERO_LIST_TIMEOUT_MS }).catch(() => {});

      const entries = (await page.evaluate(LIST_EXTRACTOR_SOURCE)) as RawListEntry[];

      const roster: RosterEntry[] = [];
      for (const entry of entries) {
        const slug = isValidSlug(entry.slug) ? entry.slug : toSlug(entry.name);
        if (!isValidSlug(slug)) continue;
        const r: RosterEntry = {
          slug,
          name: normalizeName(entry.name),
          role: 'damage',
        };
        if (entry.portrait) r.portrait_url = entry.portrait;
        roster.push(r);
      }

      const uniq = new Map<string, RosterEntry>();
      for (const r of roster) if (!uniq.has(r.slug)) uniq.set(r.slug, r);
      const deduped = Array.from(uniq.values());

      if (deduped.length < MIN_EXPECTED_HEROES) {
        throw new Error(`Hero list returned too few entries (${deduped.length} < ${MIN_EXPECTED_HEROES}). Aborting to preserve prior published data.`);
      }

      return deduped;
    } finally {
      await page.close();
    }
  }

  async scrapeAll(roster: RosterEntry[]): Promise<ScrapeResult> {
    await this.init();
    const heroes: Record<string, Hero> = {};
    const failed: Array<{ slug: string; reason: string }> = [];

    const patchVersion = await this.readPatchVersion().catch(() => new Date().toISOString().slice(0, 10));

    const total = roster.length;
    for (let i = 0; i < total; i++) {
      const entry = roster[i]!;
      const started = Date.now();
      const prefix = `[${i + 1}/${total}] ${entry.slug}`;
      try {
        const hero = await this.scrapeOne(entry);
        heroes[hero.slug] = hero;
        console.log(`${prefix} ok (${Date.now() - started}ms)`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        failed.push({ slug: entry.slug, reason });
        console.log(`${prefix} fail (${Date.now() - started}ms): ${reason}`);
        if (failed.length >= MAX_HERO_FAILURES_BEFORE_ABORT && Object.keys(heroes).length === 0) {
          throw new Error(`Too many early hero failures (${failed.length}). Aborting.`);
        }
      }
    }

    return { heroes, failed, patchVersion };
  }

  private async readPatchVersion(): Promise<string> {
    const page = await this.newPage();
    try {
      await page.goto(PATCH_NOTES_URL, { waitUntil: 'domcontentloaded' });
      const version = (await page.evaluate(PATCH_EXTRACTOR_SOURCE)) as string;
      return version || new Date().toISOString().slice(0, 10);
    } finally {
      await page.close();
    }
  }

  private async scrapeOne(entry: RosterEntry): Promise<Hero> {
    const page = await this.newPage();
    try {
      const url = `${BASE_URL}/en-us/heroes/${entry.slug}/`;
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (response && response.status() >= 400) {
        throw new Error(`HTTP ${response.status()} for ${url}`);
      }
      await page.waitForLoadState('networkidle', { timeout: HERO_PAGE_TIMEOUT_MS }).catch(() => {});

      const extraction = (await page.evaluate(EXTRACTOR_SOURCE)) as ExtractionResult;

      const role: Role = normalizeRole(extraction.role) ?? entry.role;

      const minorPerks: Perk[] = extraction.perks.minor.slice(0, 2).map((p) => ({
        name: normalizeName(p.name),
        description: normalizeDescription(p.description),
      }));
      const majorPerks: Perk[] = extraction.perks.major.slice(0, 2).map((p) => ({
        name: normalizeName(p.name),
        description: normalizeDescription(p.description),
      }));

      if (minorPerks.length !== 2 || majorPerks.length !== 2) {
        throw new Error(`Perk count mismatch: minor=${minorPerks.length}, major=${majorPerks.length} (markers ${JSON.stringify(extraction.markers)})`);
      }

      const perksJoined = [...minorPerks, ...majorPerks].map((p) => `${p.name} ${p.description}`).join(' ').toLowerCase();
      if (perksJoined.includes('stadium')) {
        throw new Error('Extracted perks contain "Stadium" — subtree isolation failed');
      }

      const abilities: Ability[] = extraction.abilities.map((a) => ({
        name: normalizeName(a.name),
        description: normalizeDescription(a.description),
      }));

      const stats: HeroStats = {
        ...(extraction.stats.health !== undefined ? { health: extraction.stats.health } : {}),
        ...(extraction.stats.armor !== undefined ? { armor: extraction.stats.armor } : {}),
        ...(extraction.stats.shields !== undefined ? { shields: extraction.stats.shields } : {}),
        abilities: {},
      };

      const hero: Hero = {
        slug: entry.slug,
        name: entry.name,
        role,
        abilities: abilities.length ? abilities : [{ name: 'TBD', description: 'Ability extraction failed for this hero.' }],
        perks: { minor: minorPerks, major: majorPerks },
        stats,
      };
      if (entry.sub_role !== undefined) hero.sub_role = entry.sub_role;
      if (entry.portrait_url !== undefined) hero.portrait_url = entry.portrait_url;

      return hero;
    } finally {
      await page.close();
    }
  }
}
