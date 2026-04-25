import type { Hero, ScrapeResult, RosterEntry } from '../types.js';

export interface HeroScraper {
  listHeroes(): Promise<RosterEntry[]>;
  // `previousHeroes` is the prior published data (keyed by slug) — used to
  // preserve AI-authored fields that the scrape can't reproduce, like
  // `abilities[].modifies[]` cross-ability effect metadata.
  scrapeAll(roster: RosterEntry[], previousHeroes?: Record<string, Hero>): Promise<ScrapeResult>;
  close(): Promise<void>;
}
