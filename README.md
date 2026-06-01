# NestIdP

Deployable SAML Identity Provider monolith (NestJS + React + SQL via Prisma).

Architecture and product scope: [docs/proposal.MD](docs/proposal.MD)

Full documentation index: [docs/README.md](docs/README.md) (diagrams in [docs/img/](docs/img/))

Development guide: [docs/development.md](docs/development.md)

Database selection: [docs/database.md](docs/database.md)

## Prerequisites

- Node.js **>= 18**
- pnpm **>= 9**
- Docker **optional** — only if you use PostgreSQL locally (`docker compose --profile postgres`)

## Quick start (SQLite — default)

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

```bash
pnpm build
NODE_ENV=production node apps/api/dist/main.js
```

Set `DATABASE_PROVIDER` and `DATABASE_URL` for your deployment database. See [docs/database.md](docs/database.md).

Or build and run the Docker image (requires `pnpm-lock.yaml` after first install).

## Environment

Copy `.env.example` to `.env` and adjust values. Required variables:

- `DATABASE_PROVIDER` — `sqlite` (dev) or `postgresql` (typical production)
- `DATABASE_URL` — must match the provider (see [docs/database.md](docs/database.md))
- `SESSION_SECRET`
- `ENCRYPTION_KEY`
- `IDP_BASE_URL`
- `NODE_ENV`

Optional bootstrap placeholders: `ADMIN_USERNAME`, `ADMIN_PASSWORD`.
