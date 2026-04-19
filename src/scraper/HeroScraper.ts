import type { ScrapeResult, RosterEntry } from '../types.js';

export interface HeroScraper {
  listHeroes(): Promise<RosterEntry[]>;
  scrapeAll(roster: RosterEntry[]): Promise<ScrapeResult>;
  close(): Promise<void>;
}
