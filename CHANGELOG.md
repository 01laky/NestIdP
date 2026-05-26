# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

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
