import {
  FANDOM_API_URL,
  FANDOM_MAX_RETRIES,
  FANDOM_MIN_INTERVAL_MS,
  FANDOM_TIMEOUT_MS,
  USER_AGENT,
} from '../config.js';
import type { DiskCache } from '../cache/diskCache.js';
import { NoopCache } from '../cache/diskCache.js';

export class FandomClient {
  private lastRequestAt = 0;

  constructor(private readonly cache: DiskCache = new NoopCache()) {}

  async getWikitext(pageTitle: string): Promise<string> {
    const url = `${FANDOM_API_URL}?action=parse&page=${encodeURIComponent(pageTitle)}&format=json&prop=wikitext`;

    const cached = await this.cache.get(url);
    if (cached) {
      const body = JSON.parse(cached.toString('utf8')) as FandomParseResponse;
      const wikitext = body.parse?.wikitext?.['*'];
      if (typeof wikitext === 'string' && wikitext.length > 0) return wikitext;
    }

    for (let attempt = 0; attempt <= FANDOM_MAX_RETRIES; attempt++) {
      await this.throttle();
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': USER_AGENT,
            'Accept-Encoding': 'gzip',
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(FANDOM_TIMEOUT_MS),
        });

        if (res.status === 429 || res.status >= 500) {
          if (attempt === FANDOM_MAX_RETRIES) {
            throw new Error(`Fandom ${res.status} after ${FANDOM_MAX_RETRIES} retries for ${pageTitle}`);
          }
          await sleep(FANDOM_MIN_INTERVAL_MS * Math.pow(2, attempt));
          continue;
        }
        if (!res.ok) {
          throw new Error(`Fandom ${res.status} for ${pageTitle}`);
        }

        const text = await res.text();
        const body = JSON.parse(text) as FandomParseResponse;
        if ('error' in body && body.error) {
          throw new Error(`Fandom API error for ${pageTitle}: ${body.error.code} ${body.error.info}`);
        }
        const wikitext = body.parse?.wikitext?.['*'];
        if (typeof wikitext !== 'string' || wikitext.length === 0) {
          throw new Error(`Fandom returned empty wikitext for ${pageTitle}`);
        }
        await this.cache.set(url, text, { url, contentType: 'application/json' });
        return wikitext;
      } catch (err) {
        if (attempt === FANDOM_MAX_RETRIES) throw err;
        const isTimeout = err instanceof Error && err.name === 'TimeoutError';
        const isNetwork = err instanceof TypeError;
        if (!isTimeout && !isNetwork) throw err;
        await sleep(FANDOM_MIN_INTERVAL_MS * Math.pow(2, attempt));
      }
    }
    throw new Error(`Fandom exhausted retries for ${pageTitle}`);
  }

  private async throttle(): Promise<void> {
    const gap = FANDOM_MIN_INTERVAL_MS - (Date.now() - this.lastRequestAt);
    if (gap > 0) await sleep(gap);
    this.lastRequestAt = Date.now();
  }
}

interface FandomParseResponse {
  parse?: {
    title?: string;
    wikitext?: { '*'?: string };
  };
  error?: { code: string; info: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
