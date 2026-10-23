import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { escapeHtml, getPostBySlug } from '../lib/posts.mjs';
import { paths } from '../lib/paths.mjs';

// The historical exporter produced both protected HTML and a JSON content record.
export function exportPrivate(root, slug) {
  const post = getPostBySlug(root, slug);
  if (!post.hidden) throw new Error('Expected a private post');
  const dest = paths(root).exported;
  mkdirSync(dest, { recursive: true });
  const postJson = { slug: post.slug, title: post.title, hidden: true, contentHtml: post.contentHtml };
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(post.title)}</title><main><article>${post.contentHtml}</article></main></html>`;
  writeFileSync(join(dest, `${slug}.json`), JSON.stringify(postJson, null, 2));
  writeFileSync(join(dest, `${slug}.html`), html);
  console.log(`Exported ${slug}.json and ${slug}.html`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) exportPrivate(process.cwd(), process.argv[2] || 'release-notes');
