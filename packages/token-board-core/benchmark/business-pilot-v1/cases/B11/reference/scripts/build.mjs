import { cpSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { paths } from '../lib/paths.mjs';

export function build(root) {
  mkdirSync(paths(root).build, { recursive: true });
  cpSync(join(root, 'site'), paths(root).build, { recursive: true });
  console.log('Static build complete');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) build(process.cwd());
