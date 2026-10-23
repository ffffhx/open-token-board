import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { paths } from '../lib/paths.mjs';

// A local substitute for copying exported records to an independent content volume.
export function syncContent(root, slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('Invalid slug');
  const dirs = paths(root);
  mkdirSync(dirs.content, { recursive: true });
  for (const ext of ['json', 'html']) copyFileSync(join(dirs.exported, `${slug}.${ext}`), join(dirs.content, `${slug}.${ext}`));
  console.log(`Synced ${slug} to content volume`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) syncContent(process.cwd(), process.argv[2] || 'release-notes');
