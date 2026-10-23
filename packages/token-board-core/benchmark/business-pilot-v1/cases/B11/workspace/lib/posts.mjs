import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderMarkdown(markdown) {
  return markdown.trim().split(/\r?\n\s*\r?\n/).map((block) => {
    const heading = block.match(/^(#{1,3}) (.+)$/);
    return heading
      ? `<h${heading[1].length}>${escapeHtml(heading[2])}</h${heading[1].length}>`
      : `<p>${escapeHtml(block).replace(/\r?\n/g, '<br>')}</p>`;
  }).join('\n');
}

export function getPostBySlug(root, slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('Invalid slug');
  const raw = readFileSync(join(root, 'source', `${slug}.md`), 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error('Missing frontmatter');
  const metadata = Object.fromEntries(match[1].split(/\r?\n/).map((line) => {
    const colon = line.indexOf(':');
    return [line.slice(0, colon), line.slice(colon + 1).trim()];
  }));
  if (metadata.slug !== slug) throw new Error('Slug mismatch');
  return { slug, title: metadata.title, hidden: metadata.hidden === 'true',
    content: match[2], contentHtml: renderMarkdown(match[2]) };
}
