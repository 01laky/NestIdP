#!/bin/sh
set -eu
cd /app

# node_modules live in named volumes (docker-compose.dev.yml), not on the bind mount.
# Rebuild/restart alone does not refresh them when pnpm-lock.yaml changes — install here.
LOCK_HASH_FILE=/app/node_modules/.pnpm-lock-hash
CURRENT_HASH=$(node -e "const fs=require('fs');const c=require('crypto');console.log(c.createHash('sha256').update(fs.readFileSync('pnpm-lock.yaml')).digest('hex'))")
STORED_HASH=
if [ -f "$LOCK_HASH_FILE" ]; then
	STORED_HASH=$(cat "$LOCK_HASH_FILE")
fi
if [ "$CURRENT_HASH" != "$STORED_HASH" ]; then
	echo "NestIdP [dev]: pnpm install (lockfile changed or stale node_modules volume)..."
	pnpm install
	echo "$CURRENT_HASH" > "$LOCK_HASH_FILE"
fi

echo "NestIdP [dev]: preparing Prisma for ${DATABASE_PROVIDER:-postgresql}..."
node ./apps/api/scripts/sync-prisma-provider.mjs

echo "NestIdP [dev]: running database migrations..."
./apps/api/node_modules/.bin/prisma migrate deploy --schema=./apps/api/prisma/schema.prisma

echo "NestIdP [dev]: generating Prisma client for ${DATABASE_PROVIDER}..."
./apps/api/node_modules/.bin/prisma generate --schema=./apps/api/prisma/schema.prisma

echo "NestIdP [dev]: building @nestidp/shared (watch mode)..."
pnpm --filter @nestidp/shared build
pnpm --filter @nestidp/shared exec tsc -w -p tsconfig.json &

export NODE_ENV=development
export CHOKIDAR_USEPOLLING="${CHOKIDAR_USEPOLLING:-true}"
export WATCHPACK_POLLING="${WATCHPACK_POLLING:-true}"
export FORCE_TSC_POLLING="${FORCE_TSC_POLLING:-true}"
export TSC_WATCHFILE="${TSC_WATCHFILE:-UseFsEventsWithFallbackDynamicPolling}"
export TSC_WATCHDIRECTORY="${TSC_WATCHDIRECTORY:-UseFsEventsWithFallbackDynamicPolling}"
export VITE_API_PROXY_TARGET="${VITE_API_PROXY_TARGET:-http://127.0.0.1:3000}"

echo "NestIdP [dev]: API http://localhost:3000 — Web (HMR) http://localhost:5173"
exec pnpm exec concurrently -n api,web -c blue,green \
	"pnpm --filter @nestidp/api dev" \
	"pnpm --filter @nestidp/web dev -- --host 0.0.0.0 --port 5173"
