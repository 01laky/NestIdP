# deploy/

Deployment artifacts for NestIdP. Full documentation: [docs/deployment.md](../docs/deployment.md)

`Dockerfile` and `Dockerfile.dev` stay in the repo root (Docker convention — compose files reference them via `context: ..`).

## Files

| File | Description |
|---|---|
| `docker-compose.prod.yml` | Production stack — single container, named DB volume (`nestidp_data`) |
| `docker-compose.dev.yml` | Development stack — bind-mount + Nest watch + Vite HMR |
| `.env.docker.prod.example` | Production env template — copy to `.env.docker.prod`, replace all secrets |
| `.env.docker.dev.example` | Dev env template — copy to `.env.docker.dev`, pre-filled, nothing to edit |

`.env.docker.prod` and `.env.docker.dev` are gitignored — never commit secrets.

## Quick start

### Development (hot reload)

```bash
cp deploy/.env.docker.dev.example deploy/.env.docker.dev
pnpm docker:dev
# Admin SPA: http://localhost:5173/admin/login
# API:       http://localhost:3000
```

### Production

```bash
cp deploy/.env.docker.prod.example deploy/.env.docker.prod
# Edit deploy/.env.docker.prod — replace all secrets, set IDP_BASE_URL (HTTPS)
pnpm docker:prod
curl -sf http://localhost:3000/ready
```

## Port usage

| Environment | Ports |
|---|---|
| `pnpm docker:prod` | `3000` (API + built SPA) |
| `pnpm docker:dev` | `3000` (API), `5173` (Vite HMR) |

> **Do not run both simultaneously on the same host** — port 3000 conflicts. Stop one before starting the other.

## DB storage

| Environment | Location | Managed by |
|---|---|---|
| `pnpm docker:prod` | Docker named volume `nestidp_data` | Docker (survives `down`, removed by `docker:prod:reset`) |
| `pnpm docker:dev` | Host file `apps/api/data/nestidp.db` (via bind-mount) | Git-ignored; inspect directly on host |

These are completely separate data stores — running one environment never touches the other's DB.

## Useful commands

| Task | Command |
|---|---|
| Follow dev logs | `pnpm docker:dev:logs` |
| Open shell in dev container | `pnpm docker:dev:shell` |
| Wipe dev volumes (node_modules) | `pnpm docker:dev:reset` |
| Follow prod logs | `pnpm docker:prod:logs` |
| Run prod migrations only | `pnpm docker:prod:migrate` |
| Wipe prod DB volume | `pnpm docker:prod:reset` |
