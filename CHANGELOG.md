# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.6.0]

### Added

- End-user auth API: **`POST /api/auth/login`**, **`GET /api/auth/me`**, **`GET /api/auth/session`**, **`POST /api/auth/logout`**, **`POST /api/auth/login/complete-sso`** (501 stub)
- **`EndUserSessionService`** — HMAC-signed **`nestidp_user_session`** cookie (separate from admin)
- **`SamlSessionBindService`** + **`SAML_SESSION_BIND_PORT`** for Prompt 07 handoff
- **`EndUserLoginRateLimiterService`** — per-IP and per-username brute-force limits
- **`EndUserAuthAuditService`** — structured login/bind/logout audit logs
- Shared: **`EndUserPublicDto`**, auth DTOs, **`AUTH_API_PATH`**, **`LOGIN_PAGE_ROUTE`**, **`SAML_SESSION_QUERY_PARAM`**
- **`createTestUserWithPassword`** test fixture
- `authApi.ts` + functional **`LoginPage`** with SSO session probe and continue stub
- Env: **`END_USER_SESSION_TTL_SECONDS`**, **`END_USER_LOGIN_RATE_LIMIT_*`**
- Integration, sync→login, E2E, and web tests

### Security

- Timing-safe password verify via shared **`verifyPasswordTimingSafe`**
- Generic **401** for all credential failures (no inactive-account enumeration)
- Never expose **`passwordHash`** in JSON responses

### Changed

- **`AuthModule`** replaces stub with full end-user auth stack
- **`IdentityRepository`** — `findUserByUsername`, `findUserProfileById`
- SSO diagram notes v0.6 (login API) vs v0.7 (SAMLResponse)
- Expanded edge-case tests for v0.6.0 — **790** total tests via `pnpm test` (53 shared + 647 API Jest + 28 API e2e + 62 web; **9** PostgreSQL smoke skipped locally)

## [0.5.0]

### Added

- **`SyncModule`** — v1 identity sync engine (fixed REST contract per proposal §7.2)
- **`POST /api/admin/sync/:connectionId`** — manual sync trigger with optional **`dryRun`**
- **`GET /api/admin/sync/:connectionId/status`** — lightweight sync status for dashboard prep
- **`GET /api/admin/sync/:connectionId/logs`**, **`GET /api/admin/sync/logs/:syncLogId`**
- **`IdentitySyncClientService`** — outbound Bearer-authenticated fetch to external identity API
- External API validators; email normalization; **`SYNC_MAX_USERS_PER_RUN`** safety cap (default 10000)
- **`SyncLogDto.durationMs`** — computed run duration in API responses
- **`IdentityRepository`** upsert/deactivate/orphan cleanup methods
- **`SyncLog`** writes with structured **`errors`** JSON
- Shared DTOs: **`SyncLogDto`**, **`TriggerSyncRequestDto`**, **`SyncStatusResponseDto`**, **`SYNC_API_PATH`**
- `adminApi.ts`: **`triggerIdentitySync`**, **`getSyncStatus`**, **`listSyncLogs`**, **`getSyncLog`**
- Env: **`SYNC_HTTP_TIMEOUT_MS`**, **`SYNC_STALE_RUN_MINUTES`**, **`SYNC_MAX_USERS_PER_RUN`**
- **`docs/examples/mock-identity-api.mjs`** — local mock identity source for dev/CI
- Integration + PostgreSQL smoke + static routing regression tests
- Docs: identity sync semantics, curl examples, upgrade guide from v0.4.0

### Changed

- **`AdminStubResponseDto`** adds **`syncApiPath`**
- **`IdentityRepository`** expanded beyond count-only stubs
- Proposal §13: manual sync + upsert checkboxes checked; §14 Q1/Q2/Q5 documented as resolved
- Expanded edge-case tests for v0.5.0 — **601** total tests (8 PostgreSQL smoke skipped locally)

### Security

- Password hashes stored only as returned by external API; never logged in sync errors
- Sync trigger protected by admin session + CSRF
- Bearer token decrypt only in server-side sync client

## [0.4.0]

### Added

- `EncryptionService` + **`CredentialsEncryptionPort`** — AES-256-GCM for API Bearer tokens at rest (`ENCRYPTION_KEY`)
- `redactBearerToken()` log helper
- `ApiConnectionsModule` — CRUD at **`API_CONNECTIONS_API_PATH`**
- **`POST /api/admin/api-connections/:id/test`** — lightweight connectivity probe (`GET /users?limit=1`)
- `base-url.util.ts` — URL parse, normalize, harden (no embedded credentials)
- `AdminCsrfGuard` + CSRF token in login/me responses; `ADMIN_CSRF_HEADER_NAME` header on mutating admin calls
- Shared DTOs: `ApiConnectionDto`, test response, create/update/list/delete types
- Shared **`API_CONNECTIONS_API_PATH`** constant
- `adminApi.ts` helpers: list/get/create/update/delete/**test** API connections
- v1 enforcement: max one `ApiConnection` per deployment; duplicate `name` guard
- `ParseCuidPipe` for route params
- Integration + PostgreSQL smoke tests; **`API-ADM-08`** stats count wiring
- Diagram `docs/img/api-connection-crud.mmd` + SVG

### Changed

- `AdminLoginResponseDto` / `AdminMeResponseDto` include `csrfToken`
- `AdminStubResponseDto` adds required **`apiConnectionsApiPath`**
- `createTestApiConnection` supports real encryption via optional `bearerToken`
- `GET /api/admin` stub note updated
- `docs/development.md` — full admin route table, curl examples, **Upgrading from v0.3.0**
- `docs/database.md`, README, `.env.example` — encryption + API connection docs
- Proposal §13: split checklist — CRUD checked, sync still open
- **Breaking:** v0.3.0 admin sessions must re-login after upgrade (CSRF in session payload)
- Expanded edge-case tests for v0.4.0 — **492** tests (6 PostgreSQL smoke skipped locally)

### Security

- Bearer tokens encrypted at rest; never returned in API JSON
- CSRF on admin mutating endpoints
- HTTPS-only `baseUrl` in production

## [0.3.0]

### Added

- Admin bootstrap: seed first `AdminUser` from env when table empty; `IdpSettings` singleton from `IDP_BASE_URL`
- `run-bootstrap.ts` shared by API startup and `prisma db seed`
- `admin-auth` module: `POST /api/admin/auth/login|logout`, `GET /api/admin/auth/me`
- Signed HTTP-only session cookie (`nestidp_admin_session`), `AdminAuthGuard`
- `PasswordService` + timing-safe `verifyPasswordTimingSafe` (bcrypt cost 12)
- Production bootstrap guard — rejects weak/default first admin password
- `LoginRateLimiterService` — in-memory brute-force protection on login
- `BCRYPT_COST_FACTOR`, admin auth DTOs, `ApiErrorResponseDto` in `@nestidp/shared`
- `AdminLoginPage` at `/admin/login`, session gate in `AdminLayout`, `adminApi.ts` fetch wrapper
- Stale session invalidation when admin row deleted; cookie cleared on 401 in web
- `createTestAdminUserWithPassword` test fixture
- ER-adjacent diagram `docs/img/admin-auth-flow.mmd` + SVG
- Integration tests: bootstrap (API-BST-\*), admin auth SQLite + PostgreSQL smoke

### Changed

- `GET /api/admin` requires authenticated admin session
- `BootstrapService` performs idempotent seeding on startup
- `.env.example`, README, `docs/database.md`, `docs/development.md` — bootstrap + admin login workflow
- Proposal Phase 1: Admin authentication (local) marked complete
- E2E routing tests expect 401 without session on admin API
- Expanded edge-case tests for v0.3.0 admin auth — **329** tests (5 PostgreSQL smoke skipped locally)

## [0.2.0]

### Added

- Full Prisma schema: ApiConnection, User, Group, Role, UserGroup, UserRole, SpConnection,
  AdminUser, SyncLog, SamlSession, IdpSettings
- Initial migration (`initial_schema`) for SQLite dev default
- `IdentityRepository` / `IdentityService` with entity counts
- `AdminStatsService` — `GET /api/admin` returns `AdminStubResponseDto` with table counts
- Shared schema enums, `PasswordHashAlgorithm` constants, and admin response types
- Integration tests for schema constraints and relations (SQLite + optional PostgreSQL smoke)
- Test fixtures (`test-fixtures.ts`) and `test-db.helper.ts` for migration-backed tests
- `prisma:migrate:deploy`, root `db:migrate` / `db:migrate:deploy` aliases
- Empty `prisma/seed.ts` stub (Prompt 03 — no runtime seeding yet)
- ER diagram `docs/img/schema-entities.mmd` + SVG
- GitHub Actions CI workflow with PostgreSQL service for cross-provider smoke tests

### Changed

- `identity` module wired to Prisma; `AdminModule` imports `IdentityModule`
- `docs/development.md`, `docs/database.md`, `README.md` — migrate workflow, production boot, ER diagram
- `Dockerfile` — comment documenting migrate-before-start
- Proposal Phase 1 checklist: Prisma schema and migrations marked complete
- Fixed `apps/api` `test:e2e` script to use `jest-e2e.config.js`
- Expanded edge-case tests for v0.2.0 data layer — **222** tests (3 PostgreSQL smoke skipped locally)

## [0.1.1]

### Changed

- Database layer is **provider-agnostic**: choose `sqlite` or `postgresql` at deploy time via
  `DATABASE_PROVIDER` + `DATABASE_URL` (validated on startup)
- **Local development default:** SQLite (`file:../data/nestidp.db`) — no Docker required
- `prisma:prepare` syncs `schema.prisma` provider before generate/migrate (Prisma requires a
  fixed provider at client generation time)
- PostgreSQL moved to optional `docker compose --profile postgres`
- Docker build accepts `DATABASE_PROVIDER` and `DATABASE_URL` build-args

### Added

- `docs/database.md` — database selection guide for dev and production
- Shared database types and URL validation in `@nestidp/shared`
- Unit tests for database provider resolution and env validation

## [0.1.0]

### Added

- pnpm monorepo scaffold: `apps/api` (NestJS), `apps/web` (React + Vite), `packages/shared`
- **Prisma** selected as ORM — empty `schema.prisma` (datasource only); domain models deferred
- NestJS stub modules: `admin`, `auth`, `sync`, `identity`, `saml` with explicit controller paths (`/api/admin`, `/api/auth`, `/saml/*`)
- Custom `SamlModule` service stubs (no XML libraries yet): request parser, response builder, metadata, POST binding
- SAML route stubs returning HTTP 501: `GET /saml/metadata`, `GET|POST /saml/sso`
- Health endpoints: `GET /health` (no DB), `GET /ready` (Prisma `SELECT 1` ping)
- Bootstrap placeholder (`BootstrapService`) reading `ADMIN_USERNAME` / `ADMIN_PASSWORD` without seeding
- Production static serving: Nest serves `apps/web/dist`; SPA fallback for `/admin/*` and `/login`
- ESLint + Prettier (tabs), root `pnpm lint`, `pnpm test`, `pnpm dev`, `pnpm build`
- Docker: `docker-compose.yml` (PostgreSQL only), multi-stage `Dockerfile`
- Comprehensive test suite (112 tests): env validation, static assets config, Prisma ping,
  admin/auth/health/SAML controllers and services, SPA fallback (503 vs index.html),
  bootstrap edge cases, shared DTO types, React LoginPage/AdminLayout/App routing
- Extracted `static-assets.config.ts` and `spa-paths.ts` for testable production static serving
- `README.md`, `.env.example`, `docs/development.md`
