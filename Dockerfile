# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
# Source and prisma schema are copied in later stages; skip postinstall (shared build + prisma:generate).
RUN pnpm install --ignore-scripts

FROM deps AS build-shared
COPY packages/shared ./packages/shared
COPY tsconfig.base.json ./
RUN pnpm --filter @nestidp/shared build

FROM build-shared AS build-web
COPY apps/web ./apps/web
RUN pnpm --filter @nestidp/web build

FROM build-shared AS build-api
COPY apps/api ./apps/api
COPY --from=build-web /app/apps/web/dist ./apps/web/dist
# Build-time DATABASE_URL is only used by `prisma generate` (client codegen); the
# runtime URL/key come from the environment. No external DB is contacted at build.
ARG DATABASE_URL=file:/tmp/build.db
ENV DATABASE_URL=${DATABASE_URL}
RUN pnpm --filter @nestidp/api prisma:generate
RUN pnpm --filter @nestidp/api build

FROM node:20-alpine AS runner
RUN apk add --no-cache openssl wget
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build-api /app/node_modules ./node_modules
COPY --from=build-api /app/apps/api/dist ./apps/api/dist
COPY --from=build-api /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build-api /app/apps/api/package.json ./apps/api/package.json
COPY --from=build-api /app/apps/api/prisma ./apps/api/prisma
COPY --from=build-api /app/apps/api/scripts ./apps/api/scripts
COPY --from=build-api /app/apps/web/dist ./apps/web/dist
COPY --from=build-api /app/packages/shared ./packages/shared
COPY package.json pnpm-workspace.yaml ./
COPY scripts/docker-entrypoint.sh /app/scripts/docker-entrypoint.sh
RUN chmod +x /app/scripts/docker-entrypoint.sh
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
	CMD wget -qO- http://127.0.0.1:3000/health || exit 1
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
