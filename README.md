# NestIdP

Deployable SAML Identity Provider monolith (NestJS + React + SQL via Prisma). **v1.1.0** — Phase 1 MVP plus responsive Evergreen operator UI (SAML SSO, admin console, identity sync, Docker deploy).

Architecture and product scope: [docs/proposal.MD](docs/proposal.MD)

Full documentation index: [docs/README.md](docs/README.md) (diagrams in [docs/img/](docs/img/))

Development guide: [docs/development.md](docs/development.md)

Database selection: [docs/database.md](docs/database.md)

Production: [docs/deployment.md](docs/deployment.md) · Go-live checklist: [docs/RELEASE.md](docs/RELEASE.md) · Identity API: [docs/integration-api.md](docs/integration-api.md)

## Prerequisites

- Node.js **>= 18**
- pnpm **>= 9**
- Docker **optional** for SQLite dev; **required** for the full Compose stack (PostgreSQL + app)

## Quick start (SQLite — local dev)

```bash
cp .env.example .env
mkdir -p apps/api/data
pnpm install
pnpm db:migrate
pnpm dev
```

| Service        | URL                          |
| -------------- | ---------------------------- |
| Web (Vite dev) | http://localhost:5173        |
| API (NestJS)   | http://localhost:3000        |
| Health         | http://localhost:3000/health |
| Readiness      | http://localhost:3000/ready  |

Vite proxies `/api`, `/saml`, `/health`, and `/ready` to the API during development.

Local SQLite database file: `apps/api/data/nestidp.db` (created on first migration).

## Quick start (Docker Compose — production-like)

```bash
cp .env.docker.example .env.docker
# Edit secrets: SESSION_SECRET, ENCRYPTION_KEY, ADMIN_PASSWORD, IDP_BASE_URL

docker compose up --build -d
curl -sf http://localhost:3000/ready
```

| Service   | URL                                                                                    |
| --------- | -------------------------------------------------------------------------------------- |
| IdP (all) | http://localhost:3000 — admin `/admin/login`, SAML `/login`, metadata `/saml/metadata` |

Migrations run automatically on container start. See [docs/deployment.md](docs/deployment.md).

## Scripts

| Command                  | Description                           |
| ------------------------ | ------------------------------------- |
| `pnpm dev`               | Build shared package, start API + web |
| `pnpm build`             | Production build (shared → web → api) |
| `pnpm lint`              | ESLint + TypeScript checks            |
| `pnpm test`              | Run all package tests                 |
| `pnpm db:migrate`        | Apply Prisma migrations (dev)         |
| `pnpm db:migrate:deploy` | Apply migrations (production)         |
| `pnpm diagrams:build`    | Render `docs/img/*.mmd` → `.svg`      |
| `pnpm diagrams:check`    | Verify SVGs are up to date            |

## Production

**Recommended:** Docker Compose or your orchestrator running the published image — [docs/deployment.md](docs/deployment.md).

```bash
cp .env.docker.example .env.docker
docker compose up --build -d
```

**Bare metal:** `pnpm build`, `pnpm db:migrate:deploy`, then `NODE_ENV=production node apps/api/dist/main.js`. Set `DATABASE_PROVIDER` and `DATABASE_URL` (PostgreSQL). Complete [docs/RELEASE.md](docs/RELEASE.md) before go-live.

## Environment

Copy `.env.example` to `.env` and adjust values. Required variables:

- `DATABASE_PROVIDER` — `sqlite` (dev) or `postgresql` (typical production)
- `DATABASE_URL` — must match the provider (see [docs/database.md](docs/database.md))
- `SESSION_SECRET`
- `ENCRYPTION_KEY`
- `IDP_BASE_URL`
- `NODE_ENV`

Optional bootstrap (first admin + IdpSettings on API start when tables are empty):

- `ADMIN_USERNAME`, `ADMIN_PASSWORD` — see [docs/database.md](docs/database.md#first-admin-bootstrap-v030)
- `ADMIN_SESSION_TTL_SECONDS` — operator session signed TTL when stay signed in is off (default 8h)
- `ADMIN_SESSION_REMEMBER_TTL_SECONDS` — persistent session when stay signed in is on (default 30d, max 90d)

Operator login: **http://localhost:5173/admin/login** (separate from end-user SAML `/login`).

Configure identity source API connections via admin REST at **`/api/admin/api-connections`**, then trigger sync at **`/api/admin/sync/:connectionId`** (see [development.md](docs/development.md)). Optional local mock: **`docs/examples/mock-identity-api.mjs`**. **`ENCRYPTION_KEY` must stay stable** — changing it invalidates stored Bearer tokens.
