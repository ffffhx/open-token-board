import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from './build.mjs';
import { exportPrivate } from './export-private.mjs';
import { syncContent } from './sync-content.mjs';
import { paths } from '../lib/paths.mjs';

export function release(root, slug) {
  build(root);
  exportPrivate(root, slug);
  syncContent(root, slug);
  mkdirSync(paths(root).static, { recursive: true });
  cpSync(paths(root).build, paths(root).static, { recursive: true });
  console.log(`Release succeeded for ${slug}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  release(process.cwd(), process.argv[2] || 'release-notes');
}
