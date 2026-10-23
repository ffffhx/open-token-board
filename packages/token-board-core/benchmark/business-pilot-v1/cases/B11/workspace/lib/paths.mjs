import { join } from 'node:path';

export function paths(root) {
  return {
    build: join(root, 'runtime', 'build'),
    exported: join(root, 'runtime', 'exported-private'),
    static: join(root, 'runtime', 'published-static'),
    content: join(root, 'runtime', 'published-content'),
  };
}
