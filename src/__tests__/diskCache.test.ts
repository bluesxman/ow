import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsDiskCache, NoopCache, clearCache } from '../cache/diskCache.js';

describe('NoopCache', () => {
  it('returns null and accepts writes silently', async () => {
    const c: import('../cache/diskCache.js').DiskCache = new NoopCache();
    expect(await c.get('any')).toBeNull();
    await c.set('any', 'body');
    expect(await c.get('any')).toBeNull();
  });
});

describe('FsDiskCache', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ow-cache-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a JSON body', async () => {
    const c = new FsDiskCache(dir);
    const url = 'https://example.com/api?q=1';
    await c.set(url, '{"hello":"world"}', { url, contentType: 'application/json' });
    const got = await c.get(url);
    expect(got?.toString('utf8')).toBe('{"hello":"world"}');
  });

  it('round-trips an HTML body', async () => {
    const c = new FsDiskCache(dir);
    const url = 'https://example.com/page';
    await c.set(url, '<html>hi</html>', { url, contentType: 'text/html; charset=utf-8' });
    const got = await c.get(url);
    expect(got?.toString('utf8')).toBe('<html>hi</html>');
  });

  it('returns null for unknown keys', async () => {
    const c = new FsDiskCache(dir);
    expect(await c.get('https://example.com/missing')).toBeNull();
  });

  it('writes an index.json mapping hash to url', async () => {
    const c = new FsDiskCache(dir);
    const url = 'https://example.com/x';
    await c.set(url, 'body', { url, contentType: 'application/json' });
    const idx = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')) as Record<
      string,
      { url: string; ext: string }
    >;
    const entries = Object.values(idx);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.url).toBe(url);
    expect(entries[0]?.ext).toBe('json');
  });

  it('clearCache removes the directory', async () => {
    const c = new FsDiskCache(dir);
    await c.set('k', 'v', { url: 'k', contentType: 'application/json' });
    await clearCache(dir);
    expect(await c.get('k')).toBeNull();
  });
});
