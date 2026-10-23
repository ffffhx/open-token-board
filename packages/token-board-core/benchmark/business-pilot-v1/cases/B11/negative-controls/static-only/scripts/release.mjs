import { cpSync, mkdirSync } from 'node:fs';
import { build } from './build.mjs';
import { paths } from '../lib/paths.mjs';

const root = process.cwd();
const slug = process.argv[2] || 'release-notes';
build(root);
mkdirSync(paths(root).static, { recursive: true });
cpSync(paths(root).build, paths(root).static, { recursive: true });
console.log(`Release succeeded for ${slug}`);
