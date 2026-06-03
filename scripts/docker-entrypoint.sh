#!/bin/sh
set -eu
cd /app

echo "NestIdP: preparing Prisma for ${DATABASE_PROVIDER:-sqlite}..."
node ./apps/api/scripts/sync-prisma-provider.mjs

echo "NestIdP: running database migrations..."
./apps/api/node_modules/.bin/prisma migrate deploy --schema=./apps/api/prisma/schema.prisma

if [ "${MIGRATE_ONLY:-0}" = "1" ]; then
	echo "NestIdP: MIGRATE_ONLY=1 — exiting after migrations."
	exit 0
fi

echo "NestIdP: starting API..."
cd /app/apps/api
exec node dist/main.js
