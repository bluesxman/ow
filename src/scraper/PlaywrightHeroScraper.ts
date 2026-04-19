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
import { normalizeDescription, normalizeName, normalizeRole, parseNumeric } from '../normalize.js';
import { isValidSlug, toSlug } from '../slug.js';
import type { Ability, AbilityStat, Hero, HeroStats, Perk, RosterEntry, Role, ScrapeResult } from '../types.js';
import { firstNonEmpty, perksHeadingLocator, stadiumHeadingLocator, abilitiesHeadingLocator, TEXT_PATTERNS } from './selectors.js';
import type { HeroScraper } from './HeroScraper.js';

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

      const entries = await page.evaluate((baseUrl) => {
        const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/en-us/heroes/"]'));
        const seen = new Map<string, { slug: string; name: string; href: string; role: string | null; portrait: string | null }>();

        for (const a of anchors) {
          const url = new URL(a.href, baseUrl);
          if (!url.pathname.startsWith('/en-us/heroes/')) continue;
          const tail = url.pathname.replace(/^\/en-us\/heroes\/?/, '').replace(/\/$/, '');
          if (!tail) continue;
          if (tail.includes('/')) continue;
          if (tail.includes('stadium')) continue;

          const nameFromText = (a.textContent ?? '').trim();
          const nameFromAria = a.getAttribute('aria-label') ?? '';
          const nameFromImg = a.querySelector('img')?.getAttribute('alt') ?? '';
          const name = [nameFromText, nameFromAria, nameFromImg].find((s) => s && s.length > 0 && s.length < 80) ?? tail;

          let role: string | null = null;
          const roleBadge = a.querySelector('[class*="role" i], [data-role]');
          if (roleBadge) {
            role = (roleBadge.getAttribute('data-role') || roleBadge.textContent || '').trim().toLowerCase() || null;
          }

          const portrait = a.querySelector('img')?.getAttribute('src') ?? null;

          const key = tail;
          if (!seen.has(key)) {
            seen.set(key, { slug: tail, name, href: url.href, role, portrait });
          }
        }
        return Array.from(seen.values());
      }, BASE_URL);

      const roster: RosterEntry[] = [];
      for (const entry of entries) {
        const slug = isValidSlug(entry.slug) ? entry.slug : toSlug(entry.name);
        if (!isValidSlug(slug)) continue;
        const role: Role | null = entry.role ? normalizeRole(entry.role) : null;
        const r: RosterEntry = {
          slug,
          name: normalizeName(entry.name),
          role: role ?? 'damage',
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

    for (const entry of roster) {
      try {
        const hero = await this.scrapeOne(entry);
        heroes[hero.slug] = hero;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        failed.push({ slug: entry.slug, reason });
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
      const version = await page.evaluate(() => {
        const headings = Array.from(document.querySelectorAll('h1,h2,h3'));
        for (const h of headings) {
          const t = (h.textContent ?? '').trim();
          const m = t.match(/([A-Z]?\d{0,2}[-\s]?)?(Season\s+\d+|S\d+).+?(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\w+\s+\d{1,2},?\s+\d{4})/i);
          if (m) return t.slice(0, 80);
          if (t.match(/patch\s+notes/i)) {
            const dateMatch = t.match(/\w+\s+\d{1,2},?\s+\d{4}/);
            if (dateMatch) return t.slice(0, 80);
          }
        }
        const time = document.querySelector('time');
        if (time) return (time.getAttribute('datetime') ?? time.textContent ?? '').trim().slice(0, 40);
        return '';
      });
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

      const perksHeading = await firstNonEmpty(perksHeadingLocator(page));
      if (!perksHeading) throw new Error('Perks heading not found');
      await perksHeading.locator.first().waitFor({ state: 'visible', timeout: HERO_PAGE_TIMEOUT_MS }).catch(() => {});

      const stadiumHeading = await firstNonEmpty(stadiumHeadingLocator(page));
      const abilitiesHeading = await firstNonEmpty(abilitiesHeadingLocator(page));

      const extraction = await page.evaluate(
        (args: {
          perksHeadingText: string;
          stadiumHeadingText: string;
          abilitiesHeadingText: string;
          minorLabelSrc: string;
          majorLabelSrc: string;
          stadiumLabelSrc: string;
        }) => {
          const perksHead = new RegExp(args.perksHeadingText, 'i');
          const stadiumHead = new RegExp(args.stadiumHeadingText, 'i');
          const abilitiesHead = new RegExp(args.abilitiesHeadingText, 'i');
          const minorLabel = new RegExp(args.minorLabelSrc, 'i');
          const majorLabel = new RegExp(args.majorLabelSrc, 'i');
          const stadiumLabel = new RegExp(args.stadiumLabelSrc, 'i');

          const allHeadings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')) as HTMLElement[];

          const findHeading = (rx: RegExp): HTMLElement | null => {
            for (const h of allHeadings) {
              const t = (h.textContent ?? '').trim();
              if (t && rx.test(t) && t.length < 60) return h;
            }
            return null;
          };

          const perksH = findHeading(/^perks$/i);
          const stadiumH = findHeading(stadiumHead);
          const abilitiesH = findHeading(abilitiesHead);

          const findPerksContainer = (): HTMLElement | null => {
            if (!perksH) return null;
            let node: HTMLElement | null = perksH;
            let best: HTMLElement | null = null;
            for (let depth = 0; depth < 8 && node; depth++) {
              const parent: HTMLElement | null = node.parentElement;
              if (!parent) break;
              const text = (parent.textContent ?? '').toLowerCase();
              const hasMinor = /minor\s+perk/i.test(text);
              const hasMajor = /major\s+perk/i.test(text);
              const hasStadium = stadiumLabel.test(text);
              if (hasMinor && hasMajor) {
                if (!hasStadium || parent.contains(stadiumH) === false) {
                  best = parent;
                }
                if (hasStadium && stadiumH && parent.contains(stadiumH)) {
                  return best;
                }
              }
              node = parent;
            }
            return best;
          };

          const perksContainer = findPerksContainer();

          const walkBetween = (start: HTMLElement, stop: HTMLElement | null): HTMLElement[] => {
            const out: HTMLElement[] = [];
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
            let inRange = false;
            let cur: Node | null = walker.currentNode;
            while (cur) {
              if (cur === start) {
                inRange = true;
                cur = walker.nextNode();
                continue;
              }
              if (inRange) {
                if (stop && cur === stop) break;
                out.push(cur as HTMLElement);
              }
              cur = walker.nextNode();
            }
            return out;
          };

          const extractPerks = (): { minor: Array<{ name: string; description: string }>; major: Array<{ name: string; description: string }> } => {
            const out = { minor: [] as Array<{ name: string; description: string }>, major: [] as Array<{ name: string; description: string }> };
            const root = perksContainer ?? document.body;
            const containerText = (root.textContent ?? '').toLowerCase();
            if (stadiumLabel.test(containerText) && !perksContainer) {
              return out;
            }

            const candidates = Array.from(root.querySelectorAll('*')) as HTMLElement[];
            const tierElements: Array<{ tier: 'minor' | 'major'; el: HTMLElement }> = [];
            for (const el of candidates) {
              const txt = (el.textContent ?? '').trim();
              if (!txt || txt.length > 40) continue;
              const ownTxt = Array.from(el.childNodes)
                .filter((n) => n.nodeType === Node.TEXT_NODE)
                .map((n) => n.textContent ?? '')
                .join('')
                .trim();
              const target = ownTxt || txt;
              if (minorLabel.test(target) && target.length < 40) tierElements.push({ tier: 'minor', el });
              else if (majorLabel.test(target) && target.length < 40) tierElements.push({ tier: 'major', el });
            }

            const seenAncestors = new Set<HTMLElement>();
            for (const { tier, el } of tierElements) {
              let node: HTMLElement | null = el;
              let card: HTMLElement | null = null;
              for (let depth = 0; depth < 6 && node; depth++) {
                node = node.parentElement;
                if (!node) break;
                const text = (node.textContent ?? '').trim();
                if (stadiumLabel.test(text)) break;
                if (text.length > 40) {
                  card = node;
                  break;
                }
              }
              if (!card || seenAncestors.has(card)) continue;
              seenAncestors.add(card);

              const headingEl = card.querySelector('h1,h2,h3,h4,h5,h6,strong,[role="heading"]') as HTMLElement | null;
              let name = '';
              if (headingEl) {
                name = (headingEl.textContent ?? '').trim();
              }
              if (!name || minorLabel.test(name) || majorLabel.test(name)) {
                const textBits = (card.innerText ?? '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
                for (const bit of textBits) {
                  if (!minorLabel.test(bit) && !majorLabel.test(bit) && bit.length > 1 && bit.length < 60) {
                    name = bit;
                    break;
                  }
                }
              }

              const paragraphs = Array.from(card.querySelectorAll('p')) as HTMLElement[];
              let description = '';
              if (paragraphs.length) {
                description = paragraphs.map((p) => (p.textContent ?? '').trim()).filter(Boolean).join(' ');
              }
              if (!description) {
                const fullLines = (card.innerText ?? '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
                description = fullLines
                  .filter((line) => !minorLabel.test(line) && !majorLabel.test(line) && line !== name)
                  .join(' ');
              }

              if (name && description) {
                out[tier].push({ name, description });
              }
            }
            return out;
          };

          const extractAbilities = (): Array<{ name: string; description: string }> => {
            if (!abilitiesH) return [];
            const container = abilitiesH.parentElement;
            if (!container) return [];
            let root: HTMLElement = container;
            for (let depth = 0; depth < 5 && root.parentElement; depth++) {
              const parent = root.parentElement;
              const t = (parent.textContent ?? '').toLowerCase();
              if ((t.match(/ability|abilities/gi) ?? []).length > 2) {
                root = parent;
              } else {
                break;
              }
            }
            const walker = walkBetween(abilitiesH, perksH);
            const sub = walker.length ? walker : Array.from(root.querySelectorAll('*'));
            const abilities: Array<{ name: string; description: string }> = [];
            const cards = (sub as HTMLElement[]).filter((el) => {
              const t = (el.textContent ?? '').trim();
              return t.length > 20 && t.length < 600 && el.querySelector('p');
            });
            const seen = new Set<string>();
            for (const card of cards) {
              const headingEl = card.querySelector('h1,h2,h3,h4,h5,h6,strong') as HTMLElement | null;
              const name = (headingEl?.textContent ?? '').trim();
              if (!name || seen.has(name)) continue;
              const p = card.querySelector('p') as HTMLElement | null;
              const description = (p?.textContent ?? '').trim();
              if (!name || !description || description.length < 8) continue;
              seen.add(name);
              abilities.push({ name, description });
            }
            return abilities;
          };

          const extractStats = (): { health?: number; armor?: number; shields?: number; abilities?: Record<string, Record<string, string>> } => {
            const pageText = document.body.innerText;
            const stats: { health?: number; armor?: number; shields?: number } = {};
            const hp = pageText.match(/\b(?:Health|HP)\s*[:\s]\s*(\d{2,4})/i);
            if (hp && hp[1]) stats.health = Number(hp[1]);
            const armor = pageText.match(/\bArmor\s*[:\s]\s*(\d{2,4})/i);
            if (armor && armor[1]) stats.armor = Number(armor[1]);
            const shields = pageText.match(/\bShields?\s*[:\s]\s*(\d{2,4})/i);
            if (shields && shields[1]) stats.shields = Number(shields[1]);
            return stats;
          };

          const roleText = (() => {
            const badges = Array.from(document.querySelectorAll('[class*="role" i], [data-role]')) as HTMLElement[];
            for (const b of badges) {
              const t = (b.getAttribute('data-role') || b.textContent || '').trim().toLowerCase();
              if (['tank', 'damage', 'support', 'dps'].includes(t)) return t;
            }
            return '';
          })();

          return {
            perks: extractPerks(),
            abilities: extractAbilities(),
            stats: extractStats(),
            role: roleText,
            containerFound: perksContainer !== null,
            stadiumSeparated: stadiumH !== null,
          };
        },
        {
          perksHeadingText: '^perks$',
          stadiumHeadingText: 'stadium\\s*(powers|items|armory)?',
          abilitiesHeadingText: '^abilities$',
          minorLabelSrc: '^\\s*minor\\s+perk\\s*$',
          majorLabelSrc: '^\\s*major\\s+perk\\s*$',
          stadiumLabelSrc: 'stadium',
        },
      );

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
        throw new Error(`Perk count mismatch: minor=${minorPerks.length}, major=${majorPerks.length}`);
      }

      const perksText = [...minorPerks, ...majorPerks]
        .map((p) => `${p.name} ${p.description}`)
        .join(' ')
        .toLowerCase();
      if (perksText.includes('stadium')) {
        throw new Error('Extracted perks contain "Stadium" text — subtree isolation failed');
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

      void parseNumeric;
      void perksHeading.tier;
      void stadiumHeading?.tier;
      void abilitiesHeading?.tier;

      const hero: Hero = {
        slug: entry.slug,
        name: entry.name,
        role,
        abilities: abilities.length ? abilities : [{ name: 'Unknown', description: 'No abilities extracted' }],
        perks: { minor: minorPerks, major: majorPerks },
        stats,
      };
      if (entry.sub_role !== undefined) hero.sub_role = entry.sub_role;
      if (entry.portrait_url !== undefined) hero.portrait_url = entry.portrait_url;

      if (abilities.length === 0) {
        hero.abilities = [{ name: 'TBD', description: 'Ability extraction failed for this hero.' }];
      }

      return hero;
    } finally {
      await page.close();
    }
  }
}

export { TEXT_PATTERNS };
