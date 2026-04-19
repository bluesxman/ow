import type { Role } from './types.js';

export function normalizeText(raw: string): string {
  return raw
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeName(raw: string): string {
  return normalizeText(raw);
}

export function normalizeDescription(raw: string): string {
  return normalizeText(raw);
}

const ROLE_MAP: Record<string, Role> = {
  tank: 'tank',
  damage: 'damage',
  dps: 'damage',
  offense: 'damage',
  support: 'support',
  healer: 'support',
};

export function normalizeRole(raw: string): Role | null {
  const key = raw.trim().toLowerCase();
  return ROLE_MAP[key] ?? null;
}

export function normalizeForCompare(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function parseNumeric(raw: string | undefined): number | string | undefined {
  if (raw === undefined) return undefined;
  const cleaned = raw.trim();
  if (cleaned === '') return undefined;
  const n = Number(cleaned.replace(/[,]/g, ''));
  if (Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(cleaned.replace(/,/g, ''))) {
    return n;
  }
  return cleaned;
}
