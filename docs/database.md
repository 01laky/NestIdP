# Database configuration

NestIdP uses **Prisma** as the ORM. The application code does not branch on a specific database engine — you choose the engine at deploy time via environment variables.

## Supported providers

| `DATABASE_PROVIDER` | Typical use                     | `DATABASE_URL` format                     |
| ------------------- | ------------------------------- | ----------------------------------------- |
| `sqlite`            | **Local development** (default) | `file:../data/nestidp.db`                 |
| `postgresql`        | Production / staging            | `postgresql://user:pass@host:5432/dbname` |

Additional providers (MySQL, etc.) can be added later if the Prisma schema stays portable.

## Local development (SQLite)

No Docker required:

```bash
cp .env.example .env
pnpm install   # runs prisma:prepare + prisma generate for sqlite
pnpm dev
```

SQLite file location (relative to `apps/api/prisma/schema.prisma`):

```
apps/api/data/nestidp.db
```

The file is gitignored. Delete it to reset local data.

## PostgreSQL (optional local or production)

Start PostgreSQL via Docker profile:

```bash
cp .env.example .env
# Edit .env:
#   DATABASE_PROVIDER=postgresql
#   DATABASE_URL=postgresql://nestidp:nestidp@localhost:5432/nestidp

docker compose --profile postgres up -d
pnpm install
pnpm --filter @nestidp/api prisma:migrate
pnpm dev
```

## How provider selection works

Prisma generates a **provider-specific client** at build/install time. NestIdP therefore:

1. Reads `DATABASE_PROVIDER` from `.env`
2. Runs `pnpm prisma:prepare` — syncs the provider line in `schema.prisma`
3. Runs `prisma generate` / `prisma migrate`

Set **`DATABASE_PROVIDER` and `DATABASE_URL` together**. The API validates that the URL scheme matches the provider on startup.

## Docker production image

Build with provider and URL build-args (PostgreSQL recommended for production):

```bash
docker build \
  --build-arg DATABASE_PROVIDER=postgresql \
  --build-arg DATABASE_URL=postgresql://user:pass@postgres:5432/nestidp \
  -t nestidp .
```

At runtime, set the same variables (or mount secrets) so `/ready` can reach the database.

## Portable schema rules

To keep switching between SQLite and PostgreSQL feasible:

- Avoid `@db.*` provider-specific annotations unless necessary
- Avoid PostgreSQL-only types (arrays, `jsonb`-specific features) in v1 models
- Run `prisma migrate` separately per provider when the schema changes
- Use Prisma Client APIs in services — never raw SQL tied to one engine

See also [development.md](./development.md) and [proposal.MD](./proposal.MD).
