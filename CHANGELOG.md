# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

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
