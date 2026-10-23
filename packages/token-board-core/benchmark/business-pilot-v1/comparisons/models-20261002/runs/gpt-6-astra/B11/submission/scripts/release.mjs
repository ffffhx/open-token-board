import { cpSync, mkdirSync } from 'node:fs';
import { build } from './build.mjs';
import { exportPrivate } from './export-private.mjs';
import { syncContent } from './sync-content.mjs';
import { paths } from '../lib/paths.mjs';

const root = process.cwd();
const slug = process.argv[2] || 'release-notes';
// Regenerate both protected formats from the current draft on every release.
// Sync only this slug so unrelated published records and unpublished drafts stay intact.
exportPrivate(root, slug);
build(root);
mkdirSync(paths(root).static, { recursive: true });
cpSync(paths(root).build, paths(root).static, { recursive: true });
syncContent(root, slug);
console.log(`Release succeeded for ${slug}`);
