# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install

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
RUN pnpm --filter @nestidp/api prisma:generate
RUN pnpm --filter @nestidp/api build

FROM node:20-alpine AS runner
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build-api /app/node_modules ./node_modules
COPY --from=build-api /app/apps/api/dist ./apps/api/dist
COPY --from=build-api /app/apps/api/package.json ./apps/api/package.json
COPY --from=build-api /app/apps/api/prisma ./apps/api/prisma
COPY --from=build-api /app/apps/web/dist ./apps/web/dist
COPY --from=build-api /app/packages/shared/dist ./packages/shared/dist
COPY --from=build-api /app/packages/shared/package.json ./packages/shared/package.json
COPY package.json pnpm-workspace.yaml ./
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
