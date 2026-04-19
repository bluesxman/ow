const SLUG_TO_TITLE_OVERRIDES: Record<string, string> = {
  'soldier-76': 'Soldier: 76',
  'dva': 'D.Va',
  'lucio': 'Lúcio',
  'torbjorn': 'Torbjörn',
  'wrecking-ball': 'Wrecking Ball',
  'junker-queen': 'Junker Queen',
};

export function slugToFandomTitle(slug: string): string {
  if (slug in SLUG_TO_TITLE_OVERRIDES) return SLUG_TO_TITLE_OVERRIDES[slug]!;
  return slug
    .split('-')
    .map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join(' ');
}

export function slugToFandomUrl(slug: string): string {
  const title = slugToFandomTitle(slug);
  return `https://overwatch.fandom.com/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

export function slugToBlizzardUrl(slug: string): string {
  return `https://overwatch.blizzard.com/en-us/heroes/${slug}/`;
}
