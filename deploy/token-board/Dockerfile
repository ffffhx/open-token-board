FROM node:22-alpine

WORKDIR /workspace
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/token-board-api/package.json ./apps/token-board-api/package.json
COPY deploy/token-board/package.json ./deploy/token-board/package.json
COPY packages/token-board-core/package.json ./packages/token-board-core/package.json
RUN corepack enable && pnpm install --filter @open-token-board/core --filter @open-token-board/api --filter @open-token-board/service --prod --frozen-lockfile

COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/token-board-api/tsconfig.json ./apps/token-board-api/tsconfig.json
COPY apps/token-board-api/src ./apps/token-board-api/src
COPY packages/token-board-core/src ./packages/token-board-core/src

WORKDIR /workspace/deploy/token-board

USER node
EXPOSE 8789

CMD ["npm", "run", "docker:start"]
