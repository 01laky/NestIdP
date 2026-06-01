# Development guide

Companion to [proposal.MD](./proposal.MD) for local setup (**v0.2.0** — full Prisma schema).

Database selection: **[database.md](./database.md)** — SQLite for local dev, PostgreSQL (or SQLite) at deploy time.

Diagram index: **[img/README.md](./img/README.md)** · regenerate with `pnpm diagrams:build`.

## Repository layout

```
apps/api/          NestJS backend (Prisma, SAML stubs, health)
apps/web/          React + Vite (admin + login placeholders)
packages/shared/   Shared TypeScript types and constants
docs/              Product and development documentation
docs/img/          Mermaid (.mmd) sources + committed SVGs
```

![NestIdP monolith architecture](./img/architecture.svg)

## ORM and database

**Prisma** ORM with full MVP schema (11 models). See [database.md](./database.md) and the [ER diagram](./img/schema-entities.svg).

| Variable            | Default (dev)             | Purpose                                 |
| ------------------- | ------------------------- | --------------------------------------- |
| `DATABASE_PROVIDER` | `sqlite`                  | Prisma engine: `sqlite` or `postgresql` |
| `DATABASE_URL`      | `file:../data/nestidp.db` | Connection string matching the provider |

First-time setup after clone:

```bash
cp .env.example .env
mkdir -p apps/api/data
pnpm install
pnpm db:migrate
```

Before `prisma generate` or `prisma migrate`, run:

```bash
pnpm --filter @nestidp/api prisma:prepare
```

This syncs `schema.prisma` with `DATABASE_PROVIDER`. Root `pnpm install` runs `prisma:generate` via `postinstall` but **not** migrate.

## Routing conventions

![Production routing](./img/routing.svg)

| Path           | Handler                           |
| -------------- | --------------------------------- |
| `/api/admin/*` | Admin REST API (stub + stats)     |
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
| Migrations not run   | 200       | 503 `disconnected`   |

`/health` never calls Prisma. The API starts even when the database is unavailable; only `/ready` reflects DB state.

## SAML module (scaffold)

Custom NestJS `SamlModule` — **no** `samlify` or `@node-saml/node-saml`. XML libraries are added when SAML logic is implemented.

Current stubs return HTTP **501** with JSON body describing deferred work.

Target SP-initiated flow: [sso-flow.svg](./img/sso-flow.svg) (see [proposal.MD](./proposal.MD) §6.2).

## Testing

```bash
pnpm test
pnpm diagrams:check
```

- `@nestidp/shared` — schema enums, password hash constants, route prefixes, database validation
- `@nestidp/api` — unit tests, schema integration tests (SQLite temp DB), optional PostgreSQL smoke (`POSTGRES_TEST_URL`), e2e routing (mocked Prisma)
- `@nestidp/web` — React route tests (admin vs login separation)

Integration tests live under `apps/api/src/prisma/*.integration.spec.ts` and run as part of `pnpm test`.

CI (`.github/workflows/ci.yml`) runs lint, test (with Postgres service), build, and `diagrams:check` on push/PR to `main`.

## Docker

- **Default dev:** SQLite — no containers required
- **Optional PostgreSQL:** `docker compose --profile postgres up -d`
- Application runs on the host via `pnpm dev` during development
- `Dockerfile` — multi-stage production image; run `db:migrate:deploy` before start in production

## Next implementation steps

1. Admin bootstrap seed + authentication (Prompt 03)
2. API connection CRUD (baseUrl + Bearer token)
3. Identity sync (fixed v1 REST contract)
4. End-user login + password verification
5. Custom SamlModule XML implementation
6. Admin SPA pages
