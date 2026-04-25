import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright';
import {
  HEROES_INDEX_URL,
  HERO_LIST_TIMEOUT_MS,
  HERO_PAGE_TIMEOUT_MS,
  MAX_HERO_FAILURES_BEFORE_ABORT,
  MIN_EXPECTED_HEROES,
  NAV_TIMEOUT_MS,
  PATCH_NOTES_URL,
  USER_AGENT,
} from '../config.js';
import type { DiskCache } from '../cache/diskCache.js';
import { NoopCache } from '../cache/diskCache.js';
import { normalizeName, normalizeRole } from '../normalize.js';
import { isValidSlug, toSlug } from '../slug.js';
import type { Hero, RosterEntry, Role, ScrapeResult } from '../types.js';
import { FandomClient } from '../sources/FandomClient.js';
import { buildHeroFromFandom, normalizeFandomHero } from '../sources/fandomNormalize.js';
import { slugToFandomTitle } from '../sources/slugToFandomTitle.js';
import type { HeroScraper } from './HeroScraper.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIST_EXTRACTOR_SOURCE = readFileSync(resolve(HERE, 'listExtractor.js'), 'utf8');
const PATCH_EXTRACTOR_SOURCE = readFileSync(resolve(HERE, 'patchExtractor.js'), 'utf8');

interface RawListEntry {
  slug: string;
  name: string;
  role: string | null;
  sub_role: string | null;
  portrait: string | null;
}

export class PlaywrightHeroScraper implements HeroScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private fandomClient: FandomClient;

  constructor(private readonly cache: DiskCache = new NoopCache()) {
    this.fandomClient = new FandomClient(cache);
  }

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
    await this.installCacheRoute();
  }

  private async installCacheRoute(): Promise<void> {
    if (!this.context) return;
    if (this.cache instanceof NoopCache) return;
    await this.context.route('**/overwatch.blizzard.com/**', async (route: Route) => {
      const req = route.request();
      if (req.method() !== 'GET') {
        await route.continue();
        return;
      }
      const url = req.url();
      const cached = await this.cache.get(url);
      if (cached) {
        await route.fulfill({
          status: 200,
          contentType: url.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8',
          body: cached,
        });
        return;
      }
      const res = await route.fetch();
      const body = await res.body();
      const ct = res.headers()['content-type'] ?? 'text/html';
      if (res.status() === 200) await this.cache.set(url, body, { url, contentType: ct });
      await route.fulfill({ response: res, body });
    });
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
        const role: Role = (entry.role ? normalizeRole(entry.role) : null) ?? 'damage';
        const r: RosterEntry = {
          slug,
          name: normalizeName(entry.name),
          role,
        };
        if (entry.sub_role) r.sub_role = normalizeName(entry.sub_role);
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

  async scrapeAll(roster: RosterEntry[], previousHeroes?: Record<string, Hero>): Promise<ScrapeResult> {
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
        const hero = await this.scrapeOne(entry, previousHeroes?.[entry.slug]);
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

  private async scrapeOne(entry: RosterEntry, previous?: Hero): Promise<Hero> {
    const title = slugToFandomTitle(entry.slug);
    const wikitext = await this.fandomClient.getWikitext(title);
    const fandom = normalizeFandomHero(wikitext);
    if (fandom.abilities.length === 0) {
      throw new Error(`Fandom page "${title}" yielded zero abilities`);
    }
    if (fandom.perks.minor.length !== 2 || fandom.perks.major.length !== 2) {
      throw new Error(
        `Fandom perk count mismatch: minor=${fandom.perks.minor.length}, major=${fandom.perks.major.length}`,
      );
    }
    return buildHeroFromFandom(entry, fandom, previous);
  }
}
