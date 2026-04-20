import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export interface DiskCache {
  get(key: string): Promise<Buffer | null>;
  set(key: string, body: Buffer | string, meta?: { url?: string; contentType?: string }): Promise<void>;
}

export class NoopCache implements DiskCache {
  async get(): Promise<null> {
    return null;
  }
  async set(): Promise<void> {}
}

export class FsDiskCache implements DiskCache {
  constructor(private readonly root: string) {}

  private hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  private pathFor(key: string, ext: string): string {
    const h = this.hashKey(key);
    return join(this.root, `${h}.${ext}`);
  }

  async get(key: string): Promise<Buffer | null> {
    for (const ext of ['html', 'json', 'bin']) {
      try {
        return await readFile(this.pathFor(key, ext));
      } catch {}
    }
    return null;
  }

  async set(
    key: string,
    body: Buffer | string,
    meta?: { url?: string; contentType?: string },
  ): Promise<void> {
    const ext = pickExt(meta?.contentType);
    const path = this.pathFor(key, ext);
    await mkdir(dirname(path), { recursive: true });
    const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    await writeFile(path, buf);
    if (meta?.url) await this.appendIndex(this.hashKey(key), meta.url, ext);
  }

  private async appendIndex(hash: string, url: string, ext: string): Promise<void> {
    const indexPath = join(this.root, 'index.json');
    let entries: Record<string, { url: string; ext: string }> = {};
    try {
      entries = JSON.parse(await readFile(indexPath, 'utf8')) as typeof entries;
    } catch {}
    entries[hash] = { url, ext };
    await writeFile(indexPath, JSON.stringify(entries, null, 2) + '\n', 'utf8');
  }
}

function pickExt(contentType: string | undefined): string {
  if (!contentType) return 'bin';
  if (contentType.includes('json')) return 'json';
  if (contentType.includes('html')) return 'html';
  return 'bin';
}

export function defaultCacheRoot(projectRoot: string): string {
  return resolve(projectRoot, '.cache');
}

export async function clearCache(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}
