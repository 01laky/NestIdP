# NestIdP

Deployable SAML Identity Provider monolith (NestJS + React + PostgreSQL).

Architecture and product scope: [docs/proposal.MD](docs/proposal.MD)

Detailed dev notes: [docs/development.md](docs/development.md)

## Prerequisites

- Node.js **>= 18**
- pnpm **>= 9**
- Docker (for local PostgreSQL)

## Quick start

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm dev
```

| Service        | URL                          |
| -------------- | ---------------------------- |
| Web (Vite dev) | http://localhost:5173        |
| API (NestJS)   | http://localhost:3000        |
| Health         | http://localhost:3000/health |
| Readiness      | http://localhost:3000/ready  |

Vite proxies `/api`, `/saml`, `/health`, and `/ready` to the API during development.

## Scripts

| Command      | Description                           |
| ------------ | ------------------------------------- |
| `pnpm dev`   | Build shared package, start API + web |
| `pnpm build` | Production build (shared → web → api) |
| `pnpm lint`  | ESLint + TypeScript checks            |
| `pnpm test`  | Run all package tests                 |

## Production

```bash
pnpm build
NODE_ENV=production node apps/api/dist/main.js
```

Or build and run the Docker image (requires `pnpm-lock.yaml` after first install).

## Environment

Copy `.env.example` to `.env` and adjust values. Required variables:

- `DATABASE_URL`
- `SESSION_SECRET`
- `ENCRYPTION_KEY`
- `IDP_BASE_URL`
- `NODE_ENV`

Optional bootstrap placeholders: `ADMIN_USERNAME`, `ADMIN_PASSWORD`.
