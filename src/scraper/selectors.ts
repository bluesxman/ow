import type { Locator, Page } from 'playwright';

export const PERKS_HEADING = /^perks$/i;
export const STADIUM_HEADING = /stadium\s*(powers|items|armory)?/i;
export const ABILITIES_HEADING = /^abilities$/i;
export const MINOR_PERK_LABEL = /^minor\s+perk$/i;
export const MAJOR_PERK_LABEL = /^major\s+perk$/i;

export interface LocatorAttempt {
  tier: 1 | 2 | 3;
  note: string;
  build: () => Locator;
}

export async function firstNonEmpty(attempts: LocatorAttempt[]): Promise<{ locator: Locator; tier: 1 | 2 | 3; note: string } | null> {
  for (const attempt of attempts) {
    const loc = attempt.build();
    const count = await loc.count();
    if (count > 0) {
      return { locator: loc, tier: attempt.tier, note: attempt.note };
    }
  }
  return null;
}

export function perksHeadingLocator(page: Page): LocatorAttempt[] {
  return [
    { tier: 1, note: 'role=heading exact Perks', build: () => page.getByRole('heading', { name: PERKS_HEADING }) },
    { tier: 2, note: 'h1-h6 text filter', build: () => page.locator('h1,h2,h3,h4,h5,h6').filter({ hasText: PERKS_HEADING }) },
    { tier: 3, note: '[data-testid*=perk]', build: () => page.locator('[data-testid*="perk" i]') },
  ];
}

export function stadiumHeadingLocator(page: Page): LocatorAttempt[] {
  return [
    { tier: 1, note: 'role=heading Stadium', build: () => page.getByRole('heading', { name: STADIUM_HEADING }) },
    { tier: 2, note: 'h1-h6 text filter Stadium', build: () => page.locator('h1,h2,h3,h4,h5,h6').filter({ hasText: STADIUM_HEADING }) },
    { tier: 3, note: '[data-testid*=stadium]', build: () => page.locator('[data-testid*="stadium" i]') },
  ];
}

export function abilitiesHeadingLocator(page: Page): LocatorAttempt[] {
  return [
    { tier: 1, note: 'role=heading exact Abilities', build: () => page.getByRole('heading', { name: ABILITIES_HEADING }) },
    { tier: 2, note: 'h1-h6 text filter', build: () => page.locator('h1,h2,h3,h4,h5,h6').filter({ hasText: ABILITIES_HEADING }) },
    { tier: 3, note: '[data-testid*=abilit]', build: () => page.locator('[data-testid*="abilit" i]') },
  ];
}

export const TEXT_PATTERNS = {
  PERKS_HEADING,
  STADIUM_HEADING,
  ABILITIES_HEADING,
  MINOR_PERK_LABEL,
  MAJOR_PERK_LABEL,
};
