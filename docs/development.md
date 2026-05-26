# Development guide

Companion to [proposal.MD](./proposal.MD) for local setup after the **0.1.0 monorepo scaffold**.

Database selection: **[database.md](./database.md)** — SQLite for local dev, PostgreSQL (or SQLite) at deploy time.

## Repository layout

```
apps/api/          NestJS backend (Prisma, SAML stubs, health)
apps/web/          React + Vite (admin + login placeholders)
packages/shared/   Shared TypeScript types and constants
docs/              Product and development documentation
```

## ORM and database

**Prisma** is the ORM for NestIdP. The scaffold includes only `datasource` configuration — no domain models yet.

| Variable            | Default (dev)             | Purpose                                 |
| ------------------- | ------------------------- | --------------------------------------- |
| `DATABASE_PROVIDER` | `sqlite`                  | Prisma engine: `sqlite` or `postgresql` |
| `DATABASE_URL`      | `file:../data/nestidp.db` | Connection string matching the provider |

Before `prisma generate` or `prisma migrate`, run:

```bash
pnpm --filter @nestidp/api prisma:prepare
```

This syncs `schema.prisma` with `DATABASE_PROVIDER`. Root `pnpm install` does this automatically via `postinstall`.

## Routing conventions

| Path           | Handler                           |
| -------------- | --------------------------------- |
| `/api/admin/*` | Admin REST API (stub)             |
| `/api/auth/*`  | Auth REST API (stub)              |
| `/saml/*`      | SAML protocol (stub, HTTP 501)    |
| `/health`      | Liveness — always OK, no database |
| `/ready`       | Readiness — Prisma ping           |
| `/admin/*`     | React admin SPA                   |
| `/login`       | React SAML login page             |

There is **no** global `/api` prefix on the Nest app. Controllers use full path segments.

## Health and readiness edge cases

| Scenario             | `/health` | `/ready`             |
| -------------------- | --------- | -------------------- |
| API running, DB down | 200       | 503 `disconnected`   |
| `DATABASE_URL` empty | 200       | 503 `not_configured` |
| DB reachable         | 200       | 200 `connected`      |

`/health` never calls Prisma. The API starts even when the database is unavailable; only `/ready` reflects DB state.

## SAML module (scaffold)

Custom NestJS `SamlModule` — **no** `samlify` or `@node-saml/node-saml`. XML libraries are added when SAML logic is implemented.

Current stubs return HTTP **501** with JSON body describing deferred work.

## Testing

```bash
pnpm test
```

- `@nestidp/shared` — route prefixes, database provider validation, type contracts
- `@nestidp/api` — unit tests (env validation, health edge cases, bootstrap, SAML stubs) + e2e routing tests
- `@nestidp/web` — React route tests (admin vs login separation)

E2e tests mock `PrismaService`; they do not require a running database.

## Docker

- **Default dev:** SQLite — no containers required
- **Optional PostgreSQL:** `docker compose --profile postgres up -d`
- Application runs on the host via `pnpm dev` during development
- `Dockerfile` — multi-stage production image (web build embedded in API container); set `DATABASE_PROVIDER` build-arg

## Next implementation steps

1. Prisma schema + migrations (users, connections, sync logs)
2. Admin bootstrap seed + authentication
3. API connection sync (fixed v1 REST contract)
4. Custom SamlModule XML implementation
5. Admin SPA pages
