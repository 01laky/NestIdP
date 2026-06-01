# Development guide

Companion to [proposal.MD](./proposal.MD) for local setup (**v0.4.0** — admin bootstrap, authentication, API connection CRUD).

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

| Path                         | Handler                                            |
| ---------------------------- | -------------------------------------------------- |
| `/api/admin/*`               | Admin REST API (requires session except auth)      |
| `/api/admin/auth/login`      | Operator login (public)                            |
| `/api/admin/auth/logout`     | Clears session cookie (CSRF when session present)  |
| `/api/admin/auth/me`         | Current admin session + `csrfToken` (protected)    |
| `/api/admin/api-connections` | API connection CRUD + connectivity test            |
| `/api/auth/*`                | End-user auth REST API (stub)                      |
| `/saml/*`                    | SAML protocol (stub, HTTP 501)                     |
| `/health`                    | Liveness — always OK, no database                  |
| `/ready`                     | Readiness — Prisma ping                            |
| `/admin/login`               | React operator login (separate from SAML `/login`) |
| `/admin/*`                   | React admin SPA (session gate)                     |
| `/login`                     | React SAML login page                              |

![Admin login sequence](./img/admin-auth-flow.svg)

### Admin REST API (v0.4.0)

Full operator surface:

| Method | Path                                  | Auth    | CSRF  | Description                                        |
| ------ | ------------------------------------- | ------- | ----- | -------------------------------------------------- |
| POST   | `/api/admin/auth/login`               | —       | —     | Operator login                                     |
| POST   | `/api/admin/auth/logout`              | session | yes\* | Logout (\*when session cookie present)             |
| GET    | `/api/admin/auth/me`                  | session | —     | Session + `csrfToken`                              |
| GET    | `/api/admin`                          | session | —     | Dashboard stats stub                               |
| GET    | `/api/admin/api-connections`          | session | —     | List API connections                               |
| POST   | `/api/admin/api-connections`          | session | yes   | Create connection (**v1: max 1**)                  |
| GET    | `/api/admin/api-connections/:id`      | session | —     | Get connection                                     |
| PATCH  | `/api/admin/api-connections/:id`      | session | yes   | Update connection                                  |
| DELETE | `/api/admin/api-connections/:id`      | session | yes   | Delete connection                                  |
| POST   | `/api/admin/api-connections/:id/test` | session | yes   | Connectivity probe (`GET {baseUrl}/users?limit=1`) |

Constants in `@nestidp/shared`:

- **`API_CONNECTIONS_API_PATH`** — REST base (`/api/admin/api-connections`)
- **`API_CONNECTION_ROUTE_PREFIX`** — future React UI route (`/admin/api-connections`, Prompt 08)
- **`ADMIN_CSRF_HEADER_NAME`** — `X-CSRF-Token` on mutating admin calls

![API connection CRUD flow](./img/api-connection-crud.svg)

Bearer tokens are encrypted at rest (AES-256-GCM via `ENCRYPTION_KEY`); API responses expose `hasBearerToken: true` but **never** the plaintext token.

### Admin session cookies and CSRF

Operator sessions use signed HTTP-only cookie **`nestidp_admin_session`** (HMAC-SHA256 + `SESSION_SECRET`). The signed payload includes a **`csrfToken`** (v0.4.0+).

| Environment            | `Secure` cookie flag                                |
| ---------------------- | --------------------------------------------------- |
| `production`           | `true` (HTTPS required per proposal §10.2)          |
| `development` / `test` | `false` — allows `http://localhost` with Vite proxy |

On login and `GET /me`, the API returns the same `csrfToken` in JSON. The web client (`adminApi.ts`) stores it in memory and sends **`X-CSRF-Token`** on `POST`, `PATCH`, and `DELETE`.

Vite dev server proxies `/api` to Nest; admin fetches must use **`credentials: 'include'`** (see `apps/web/src/admin/adminApi.ts`).

First boot: set `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env` — bootstrap creates the first admin when the table is empty. Change default password after deploy.

**v1 single-connection limit:** only one `ApiConnection` row may exist until multi-source sync (Phase 3). A second `POST` returns **409 Conflict**.

**Production `baseUrl`:** when `NODE_ENV=production`, API connection `baseUrl` must use `https:`.

There is **no** global `/api` prefix on the Nest app. Controllers use full path segments.

#### curl example (login → create → test)

```bash
COOKIE_JAR=$(mktemp)

# Login
LOGIN=$(curl -s -c "$COOKIE_JAR" -X POST http://localhost:3000/api/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"YOUR_PASSWORD"}')
CSRF=$(echo "$LOGIN" | jq -r .csrfToken)

# Create API connection
curl -s -b "$COOKIE_JAR" -X POST http://localhost:3000/api/admin/api-connections \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"name":"Corp HR","baseUrl":"https://identity.example.com","bearerToken":"secret-token"}'

# List connections (no CSRF on GET)
curl -s -b "$COOKIE_JAR" http://localhost:3000/api/admin/api-connections

# Connectivity test (replace CONNECTION_ID)
curl -s -b "$COOKIE_JAR" -X POST "http://localhost:3000/api/admin/api-connections/CONNECTION_ID/test" \
  -H "X-CSRF-Token: $CSRF"
```

### Upgrading from v0.3.0

| Change                                                       | Action                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| CSRF in session payload                                      | All operators **must re-login** after upgrade; old cookies cannot mutate |
| `ApiConnection` rows with dummy `TEST_ENCRYPTED_CREDENTIALS` | **DELETE** and recreate via API, or **PATCH** with new `bearerToken`     |
| `ENCRYPTION_KEY`                                             | Must be set and **kept stable** — changing it invalidates stored tokens  |
| New env in `.env.example`                                    | Merge any missing vars from updated `.env.example`                       |

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

## Git hooks

Once per clone, install repo hooks (strip / block AI co-author trailers in commit messages):

```bash
./scripts/setup-githooks.sh
```

This sets `core.hooksPath=.githooks`. Hooks run on `prepare-commit-msg` and `commit-msg` — commits are **rejected** if `Co-authored-by: Cursor`, `cursoragent@cursor.com`, or similar attribution remains.

## Docker

- **Default dev:** SQLite — no containers required
- **Optional PostgreSQL:** `docker compose --profile postgres up -d`
- Application runs on the host via `pnpm dev` during development
- `Dockerfile` — multi-stage production image; run `db:migrate:deploy` before start in production

## Next implementation steps

1. ~~Admin bootstrap seed + authentication (Prompt 03)~~
2. ~~API connection CRUD (baseUrl + Bearer token) (Prompt 04)~~
3. Identity sync (fixed v1 REST contract) — Prompt 05
4. End-user login + password verification
5. Custom SamlModule XML implementation
6. Admin SPA pages
