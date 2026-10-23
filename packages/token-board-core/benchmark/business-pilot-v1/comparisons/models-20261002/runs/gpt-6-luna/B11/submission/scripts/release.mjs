import { cpSync, mkdirSync } from 'node:fs';
import { build } from './build.mjs';
import { exportPrivate } from './export-private.mjs';
import { syncContent } from './sync-content.mjs';
import { paths } from '../lib/paths.mjs';

const root = process.cwd();
const slug = process.argv[2] || 'release-notes';
// Rebuild the private record from source on every release. The content volume
// is independent of the static site, so explicitly sync the exported records.
exportPrivate(root, slug);
syncContent(root, slug);
build(root);
mkdirSync(paths(root).static, { recursive: true });
cpSync(paths(root).build, paths(root).static, { recursive: true });
console.log(`Release succeeded for ${slug}`);
