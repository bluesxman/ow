import { resolve } from 'node:path';
import process from 'node:process';
import { clearCache, defaultCacheRoot } from '../src/cache/diskCache.js';

async function main(): Promise<void> {
  const root = defaultCacheRoot(resolve(process.cwd()));
  await clearCache(root);
  console.log(`cleared ${root}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
