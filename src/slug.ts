import { SLUG_OVERRIDES } from './config.js';

export function toSlug(heroName: string): string {
  const key = heroName.trim().toLowerCase();
  const override = SLUG_OVERRIDES[key];
  if (override) return override;

  const decomposed = heroName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return decomposed
    .toLowerCase()
    .replace(/[:'']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}
