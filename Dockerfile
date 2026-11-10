# ==============================================================================
# Settle Monorepo Multi-Stage Dockerfile (Production)
# ==============================================================================

# Stage 1: Build & Prepare
FROM node:20-alpine AS builder

WORKDIR /app

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

# Copy root configuration and dependency manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/engine/package.json ./packages/engine/
COPY packages/engine/tsconfig.json ./packages/engine/
COPY packages/engine/tsconfig.build.json ./packages/engine/
COPY packages/agent/package.json ./packages/agent/
COPY packages/agent/tsconfig.json ./packages/agent/
COPY packages/agent/tsconfig.build.json ./packages/agent/
COPY apps/api/package.json ./apps/api/
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/web/tsconfig.json ./apps/web/

# Install dependencies (frozen lockfile)
RUN pnpm install --frozen-lockfile

# Copy source code and seed fixtures
COPY seed/ ./seed/
COPY packages/shared/ ./packages/shared/
COPY packages/engine/ ./packages/engine/
COPY packages/agent/ ./packages/agent/
COPY apps/api/ ./apps/api/
COPY apps/web/ ./apps/web/

# Build TypeScript packages and web SPA (real same-origin mode, mocks disabled)
RUN pnpm --filter @settle/shared build && pnpm --filter @settle/engine build && pnpm --filter @settle/agent build && pnpm --filter @settle/api build && VITE_USE_MOCKS="" VITE_API_BASE="" pnpm --filter web build

# Stage 2: Production Runner
FROM node:20-alpine AS runner

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Copy root workspace files for production install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/engine/package.json ./packages/engine/
COPY packages/agent/package.json ./packages/agent/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install production-only dependencies (ignore lifecycle scripts)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Copy compiled artifacts from builder
COPY seed/ ./seed/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/engine/dist ./packages/engine/dist
COPY --from=builder /app/packages/agent/dist ./packages/agent/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist

# Secure unprivileged user
USER node

EXPOSE 3000

CMD ["node", "apps/api/dist/index.js"]

