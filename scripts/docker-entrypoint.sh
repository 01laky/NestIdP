#!/bin/sh
set -eu
cd /app/apps/api

# The application owns schema migrations: main.js applies pending migrations
# through the keyed libSQL adapter before listening (and honors MIGRATE_ONLY=1
# to migrate-and-exit). The encrypted DB file cannot be opened by the Prisma
# CLI, so there is no `prisma migrate deploy` step here.
echo "NestIdP: starting API (migrations run at startup)..."
exec node dist/main.js
