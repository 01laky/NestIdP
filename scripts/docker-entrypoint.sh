#!/bin/sh
set -eu
cd /app

echo "NestIdP: running database migrations..."
pnpm --filter @nestidp/api prisma:migrate:deploy

if [ "${MIGRATE_ONLY:-0}" = "1" ]; then
	echo "NestIdP: MIGRATE_ONLY=1 — exiting after migrations."
	exit 0
fi

echo "NestIdP: starting API..."
exec node apps/api/dist/main.js
