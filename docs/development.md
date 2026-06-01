# Development guide

Companion to [proposal.MD](./proposal.MD) for local setup (**v0.6.0** — admin bootstrap, API connections, identity sync, end-user login).

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
| `/api/admin/sync/*`          | Identity sync trigger, status, logs                |
| `/api/auth/*`                | End-user login API (synced credentials)            |
| `/saml/*`                    | SAML protocol (stub, HTTP 501)                     |
| `/health`                    | Liveness — always OK, no database                  |
| `/ready`                     | Readiness — Prisma ping                            |
| `/admin/login`               | React operator login (separate from SAML `/login`) |
| `/admin/*`                   | React admin SPA (session gate)                     |
| `/login`                     | React SAML login page                              |

![Admin login sequence](./img/admin-auth-flow.svg)

### End-user auth API (v0.6.0)

| Method | Path                                     | Auth                          | Description                                                                                          |
| ------ | ---------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| POST   | `/api/auth/login`                        | —                             | Username + password against synced `User`; optional `{ "samlSessionId" }` binds pending SAML session |
| GET    | `/api/auth/me`                           | `nestidp_user_session` cookie | Profile with group/role names (no secrets)                                                           |
| GET    | `/api/auth/session`                      | —                             | Read-only: `authenticated` + optional `?samlSessionId=` pending SAML state                           |
| POST   | `/api/auth/logout`                       | cookie optional               | Clears end-user session (idempotent)                                                                 |
| POST   | `/api/auth/login/complete-sso`           | end-user session              | Signed SAMLResponse as **text/html** auto-post form to SP ACS                                        |
| GET    | `/saml/metadata`                         | —                             | IdP SAML metadata XML                                                                                |
| GET    | `/saml/sso`                              | —                             | SP-initiated SSO (HTTP-Redirect `SAMLRequest`) → redirect `/login?samlSessionId=`                    |
| GET    | `/api/admin/sp-connections`              | admin session                 | List SP connections                                                                                  |
| POST   | `/api/admin/sp-connections`              | admin session                 | Create SP (CSRF)                                                                                     |
| PATCH  | `/api/admin/sp-connections/:id`          | admin session                 | Update SP (CSRF)                                                                                     |
| DELETE | `/api/admin/sp-connections/:id`          | admin session                 | Delete SP (CSRF)                                                                                     |
| POST   | `/api/admin/sp-connections/:id/test-acs` | admin session                 | ACS reachability probe (CSRF)                                                                        |
| GET    | `/api/admin/idp/metadata-url`            | admin session                 | Public metadata + SSO URLs for operators                                                             |
| GET    | `/api/admin/identity/users`              | admin session                 | Browse synced users (`?search=`, `limit`, `offset`)                                                  |
| GET    | `/api/admin/identity/users/:id`          | admin session                 | User detail with groups and roles                                                                    |
| GET    | `/api/admin/identity/groups`             | admin session                 | Browse groups                                                                                        |
| GET    | `/api/admin/identity/roles`              | admin session                 | Browse roles                                                                                         |

Constants:

- **`AUTH_API_PATH`** — `/api/auth`
- **`END_USER_SESSION_COOKIE_NAME`** — `nestidp_user_session`
- **`LOGIN_PAGE_ROUTE`** — `/login`
- **`SAML_SESSION_QUERY_PARAM`** — `samlSessionId` (Prompt 07 redirects here after parsing SAMLRequest)
- **`SAML_SESSION_BIND_PORT`** — Nest token for `SamlSessionBindPort` (Prompt 07 imports from `AuthModule`)

#### End-user login (v1)

- **Login identifier:** `User.username` only (trimmed, **case-sensitive** — `Alice` ≠ `alice`)
- **bcrypt-only** verification via shared `verifyPasswordTimingSafe`
- **Inactive users** (`active: false`) → generic **401** `Invalid username or password`
- **Rate limits:** per-IP (default 10 / 15 min) and per-username (default 5 / 15 min), separate from admin
- **No CSRF** on end-user routes (admin-only in v1)
- **SAML prep:** optional `samlSessionId` on login binds `SamlSession.userId`; SAML XML/POST is **Prompt 07**
- **SP branding:** none in v0.6 (proposal §14 Q3 — single neutral `/login` page)
- **Audit:** structured stdout events (`end_user_login_success`, `end_user_login_failure`, …) — persistent audit table → Prompt 10

Optional env:

| Variable                                       | Default  | Purpose                      |
| ---------------------------------------------- | -------- | ---------------------------- |
| `END_USER_SESSION_TTL_SECONDS`                 | `3600`   | End-user session cookie TTL  |
| `END_USER_LOGIN_RATE_LIMIT_MAX`                | `10`     | IP failures per window       |
| `END_USER_LOGIN_RATE_LIMIT_WINDOW_MS`          | `900000` | IP window                    |
| `END_USER_LOGIN_RATE_LIMIT_USERNAME_MAX`       | `5`      | Username failures per window |
| `END_USER_LOGIN_RATE_LIMIT_USERNAME_WINDOW_MS` | `900000` | Username window              |

#### Dev proxy and cookies

`apps/web/vite.config.ts` proxies `/api`, `/saml`, `/health`, `/ready` to `VITE_API_PROXY_TARGET` (default `http://localhost:3000`). The login page uses `credentials: 'include'` — browser tests require this proxy (or same-origin production build).

```bash
# After sync created user "alice" with known password
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"your-password"}'

curl -b cookies.txt http://localhost:3000/api/auth/me
```

#### SAML / SSO (v0.7.0)

1. `GET /saml/sso?SAMLRequest=&RelayState=` — parse AuthnRequest, create `SamlSession`, **302** to `/login?samlSessionId=<cuid>`
2. `POST /api/auth/login` with optional `samlSessionId` — binds `SamlSession.userId`
3. `GET /api/auth/session?samlSessionId=` — `readyToComplete` when bound + authenticated user matches
4. `POST /api/auth/login/complete-sso` (session required) — signed `SAMLResponse` as HTML form POST to `SpConnection.acsUrl`
5. `LoginPage` auto-calls complete-sso after bind or when `readyToComplete` on refresh

**Default SAML attributes** (when `attributeMapping` is null): `email`, `displayName`, `memberOf` (groups), `role` (roles). NameID: email when format is email-oriented, else `username`.

**Operator SP setup:** Admin UI at `/admin/sp-connections` or REST CRUD above. Mock SP URL:

```bash
SP_ENTITY_ID=urn:test:sp node docs/examples/saml-sp-initiated-redirect.mjs
```

| Env var                            | Default | Purpose                                           |
| ---------------------------------- | ------- | ------------------------------------------------- |
| `SAML_ASSERTION_TTL_SECONDS`       | `300`   | Assertion `NotOnOrAfter` window                   |
| `SAML_SESSION_TTL_SECONDS`         | `900`   | Pending `SamlSession` TTL                         |
| `SAML_CLOCK_SKEW_SECONDS`          | `120`   | `IssueInstant` validation skew                    |
| `SAML_METADATA_INCLUDE_ACS`        | `true`  | `AttributeConsumingService` in metadata           |
| `SAML_SESSION_CLEANUP_INTERVAL_MS` | `0`     | Periodic expired-session purge (0 = startup only) |

Inject `@Inject(SAML_SESSION_BIND_PORT)` from `AuthModule` — do not duplicate bind SQL in `SamlModule`.

**Prompt 09:** IdP cert upload/rotation UI (admin settings). **Prompt 10:** Docker packaging.

### Admin REST API (v0.5.0)

Full operator surface:

| Method | Path                                   | Auth    | CSRF  | Description                                           |
| ------ | -------------------------------------- | ------- | ----- | ----------------------------------------------------- |
| POST   | `/api/admin/auth/login`                | —       | —     | Operator login                                        |
| POST   | `/api/admin/auth/logout`               | session | yes\* | Logout (\*when session cookie present)                |
| GET    | `/api/admin/auth/me`                   | session | —     | Session + `csrfToken`                                 |
| GET    | `/api/admin`                           | session | —     | Dashboard (`AdminDashboardResponseDto`)               |
| GET    | `/api/admin/api-connections`           | session | —     | List API connections                                  |
| POST   | `/api/admin/api-connections`           | session | yes   | Create connection (**v1: max 1**)                     |
| GET    | `/api/admin/api-connections/:id`       | session | —     | Get connection                                        |
| PATCH  | `/api/admin/api-connections/:id`       | session | yes   | Update connection                                     |
| DELETE | `/api/admin/api-connections/:id`       | session | yes   | Delete connection                                     |
| POST   | `/api/admin/api-connections/:id/test`  | session | yes   | Connectivity probe (`GET {baseUrl}/users?limit=1`)    |
| POST   | `/api/admin/sync/:connectionId`        | session | yes   | Trigger identity sync (optional `{ "dryRun": true }`) |
| GET    | `/api/admin/sync/:connectionId/status` | session | —     | Sync status + latest log                              |
| GET    | `/api/admin/sync/:connectionId/logs`   | session | —     | List sync logs (`?limit=`, default 20, max 100)       |
| GET    | `/api/admin/sync/logs/:syncLogId`      | session | —     | Get sync log detail                                   |

Constants in `@nestidp/shared`:

- **`API_CONNECTIONS_API_PATH`** — REST base (`/api/admin/api-connections`)
- **`SYNC_API_PATH`** — identity sync REST base (`/api/admin/sync`)
- **`API_CONNECTION_ROUTE_PREFIX`** — React UI route (`/admin/api-connections`)
- **`SP_CONNECTION_ROUTE_PREFIX`** — React UI route (`/admin/sp-connections`)
- **`IDENTITY_ROUTE_PREFIX`** — React UI route (`/admin/identity`)
- **`ADMIN_CSRF_HEADER_NAME`** — `X-CSRF-Token` on mutating admin calls

![API connection CRUD flow](./img/api-connection-crud.svg)

![Identity sync flow](./img/sync-flow.svg)

Bearer tokens are encrypted at rest (AES-256-GCM via `ENCRYPTION_KEY`); API responses expose `hasBearerToken: true` but **never** the plaintext token.

### Identity sync semantics (v1)

- **Full snapshot sync** per run — no incremental/delta filter on `GET /users` (proposal §14 Q1 resolved)
- **Soft-deactivate** users missing from the latest snapshot (`active: false`, memberships cleared) — never hard-delete (§14 Q2)
- **bcrypt-only** `passwordHashAlgorithm` from external API (§14 Q5)
- **Email normalization** — trim + lowercase before persist
- **`SYNC_MAX_USERS_PER_RUN`** (default 10000) caps snapshot size
- **`durationMs`** on `SyncLogDto` is computed in API responses (not a DB column)
- **`dryRun: true`** — fetches external API, writes `SyncLog`, but does **not** mutate `User`/`Group`/`Role` or `lastSyncAt`
- **Concurrency** — only one real sync per connection; stale `IN_PROGRESS` runs auto-fail after `SYNC_STALE_RUN_MINUTES` (default 30)
- **Partial errors** — per-user failures go to `SyncLog.errors[]`; run completes with `SUCCESS` unless fetch/decrypt fails
- **Upsert failure** skips groups/roles fetch for that user
- External contract: [proposal.MD §7.2](./proposal.MD)

Optional env:

| Variable                 | Default | Purpose                                |
| ------------------------ | ------- | -------------------------------------- |
| `SYNC_HTTP_TIMEOUT_MS`   | `30000` | Outbound HTTP timeout per request      |
| `SYNC_STALE_RUN_MINUTES` | `30`    | Stale sync recovery threshold          |
| `SYNC_MAX_USERS_PER_RUN` | `10000` | Max users in one `GET /users` response |

### Local mock identity API (dev / CI)

```bash
# Terminal 1
node docs/examples/mock-identity-api.mjs

# Terminal 2 — create connection with baseUrl http://localhost:4001, bearerToken test-token
# Then POST /api/admin/sync/:connectionId
```

See [docs/examples/mock-identity-api.mjs](./examples/mock-identity-api.mjs).

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

# Trigger identity sync (replace CONNECTION_ID)
curl -s -b "$COOKIE_JAR" -X POST "http://localhost:3000/api/admin/sync/CONNECTION_ID" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{}'

# Dry run (no DB changes)
curl -s -b "$COOKIE_JAR" -X POST "http://localhost:3000/api/admin/sync/CONNECTION_ID" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"dryRun":true}'

# Poll sync status
curl -s -b "$COOKIE_JAR" "http://localhost:3000/api/admin/sync/CONNECTION_ID/status"

# List sync logs
curl -s -b "$COOKIE_JAR" "http://localhost:3000/api/admin/sync/CONNECTION_ID/logs?limit=10"
```

### Upgrading from v0.4.0

| Change              | Action                                                                 |
| ------------------- | ---------------------------------------------------------------------- |
| New sync endpoints  | No migration; configure API connection then `POST /api/admin/sync/:id` |
| External API        | Must implement fixed v1 contract ([§7.2](./proposal.MD))               |
| Stuck `IN_PROGRESS` | Wait `SYNC_STALE_RUN_MINUTES` or trigger sync after stale recovery     |
| Large directories   | Tune `SYNC_MAX_USERS_PER_RUN` and `SYNC_HTTP_TIMEOUT_MS`               |

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
3. ~~Identity sync (fixed v1 REST contract) — Prompt 05~~
4. ~~End-user login + password verification — Prompt 06~~
5. Custom SamlModule XML implementation (Prompt 07)
6. Admin SPA pages
