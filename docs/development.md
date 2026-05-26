# Development guide

Companion to [proposal.MD](./proposal.MD) for local setup after the **0.1.0 monorepo scaffold**.

## Repository layout

```
apps/api/          NestJS backend (Prisma, SAML stubs, health)
apps/web/          React + Vite (admin + login placeholders)
packages/shared/   Shared TypeScript types and constants
docs/              Product and development documentation
```

## ORM choice

**Prisma** is the ORM for NestIdP. The scaffold includes only `datasource` configuration — no domain models yet. Schema and migrations are the next implementation step.

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

`/health` never calls Prisma. The API starts even when PostgreSQL is unavailable; only `/ready` reflects DB state.

## SAML module (scaffold)

Custom NestJS `SamlModule` — **no** `samlify` or `@node-saml/node-saml`. XML libraries are added when SAML logic is implemented.

Current stubs return HTTP **501** with JSON body describing deferred work.

## Testing

```bash
pnpm test
```

- `@nestidp/shared` — route prefix separation, type contracts
- `@nestidp/api` — unit tests (env validation, health edge cases, bootstrap, SAML stubs) + e2e routing tests
- `@nestidp/web` — React route tests (admin vs login separation)

E2e tests mock `PrismaService`; they do not require a running database.

## Docker

- `docker compose up -d` — PostgreSQL only on port 5432
- Application runs on the host via `pnpm dev` during development
- `Dockerfile` — multi-stage production image (web build embedded in API container)

## Next implementation steps

1. Prisma schema + migrations (users, connections, sync logs)
2. Admin bootstrap seed + authentication
3. API connection sync (fixed v1 REST contract)
4. Custom SamlModule XML implementation
5. Admin SPA pages
