import process from 'node:process';
import { FANDOM_API_URL, FANDOM_MIN_INTERVAL_MS, USER_AGENT } from '../src/config.js';
import { FandomClient } from '../src/sources/FandomClient.js';
import { parseWikitext } from '../src/sources/fandomWikitext.js';
import { normalizeFandomHero } from '../src/sources/fandomNormalize.js';
import { slugToFandomTitle, slugToFandomUrl } from '../src/sources/slugToFandomTitle.js';

async function checkGzip(pageTitle: string): Promise<void> {
  const url = `${FANDOM_API_URL}?action=parse&page=${encodeURIComponent(pageTitle)}&format=json&prop=wikitext`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Encoding': 'gzip',
      Accept: 'application/json',
    },
  });
  const encoding = res.headers.get('content-encoding') ?? '<none>';
  console.log(`  content-encoding: ${encoding}`);
  if (!encoding.toLowerCase().includes('gzip')) {
    console.warn('  WARN: Fandom did not return gzip-encoded response');
  }
  await res.body?.cancel();
}

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: tsx scripts/probe-fandom.ts <slug>');
    console.error('Example: tsx scripts/probe-fandom.ts reaper');
    process.exit(1);
  }

  const title = slugToFandomTitle(slug);
  const wikiUrl = slugToFandomUrl(slug);
  console.log(`slug:      ${slug}`);
  console.log(`title:     ${title}`);
  console.log(`wiki url:  ${wikiUrl}`);
  console.log('');

  console.log('--- gzip check ---');
  await checkGzip(title);
  console.log('');

  const client = new FandomClient();

  console.log('--- request #1 ---');
  const t1 = Date.now();
  const wikitext = await client.getWikitext(title);
  const elapsed1 = Date.now() - t1;
  console.log(`  fetched ${wikitext.length} chars in ${elapsed1}ms`);

  const { infobox, abilities } = parseWikitext(wikitext);
  console.log(`  infobox: ${infobox ? 'found' : 'MISSING'}`);
  console.log(`  ability blocks parsed: ${abilities.length}`);
  console.log('');

  const hero = normalizeFandomHero(infobox, abilities);
  console.log('--- normalized output ---');
  console.log(`  sub_role: ${hero.sub_role ?? '<none>'}`);
  console.log(`  health:   ${hero.stats.health ?? '<none>'}`);
  console.log(`  armor:    ${hero.stats.armor ?? '<none>'}`);
  console.log(`  shields:  ${hero.stats.shields ?? '<none>'}`);
  console.log('  abilities:');
  for (const [name, stats] of Object.entries(hero.stats.abilities ?? {})) {
    const summary = Object.entries(stats)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    console.log(`    ${name}: ${summary || '<no fields>'}`);
  }
  console.log('');

  console.log('--- throttle check (request #2) ---');
  const t2 = Date.now();
  await client.getWikitext(title);
  const gap = Date.now() - t2;
  console.log(`  second request returned after ${gap}ms (min interval ${FANDOM_MIN_INTERVAL_MS}ms)`);
  const TOLERANCE_MS = 50;
  if (gap < FANDOM_MIN_INTERVAL_MS - TOLERANCE_MS) {
    console.error(`  FAIL: gap ${gap}ms < min interval ${FANDOM_MIN_INTERVAL_MS}ms (tolerance ${TOLERANCE_MS}ms)`);
    process.exit(1);
  }
  console.log('  OK: throttle respected');
}

main().catch((err) => {
  console.error('Probe failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
