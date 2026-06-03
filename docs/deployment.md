# Deployment guide

NestIdP **v1.0.0** ships as a single Docker image (NestJS API + built React SPA). Production deployments should use **PostgreSQL**; SQLite is for local development only.

Related: [RELEASE.md](./RELEASE.md) (go-live checklist) · [database.md](./database.md) · [integration-api.md](./integration-api.md)

---

## Prerequisites

- Docker and Docker Compose (v2)
- Secrets: `SESSION_SECRET`, `ENCRYPTION_KEY` (≥ 16 characters; generate with `openssl rand -hex 32`)
- Public URL for browsers and SAML SPs: `IDP_BASE_URL` (HTTPS in production)
- Optional: TLS-terminating load balancer in front of the container

---

## First deploy (Docker Compose)

1. Copy the compose environment template:

```bash
cp .env.docker.example .env.docker
```

2. Edit `.env.docker` — set strong `SESSION_SECRET`, `ENCRYPTION_KEY`, `ADMIN_PASSWORD` (min 12 chars in production), and `IDP_BASE_URL` to the URL users and SPs use (e.g. `https://idp.example.com`).

3. Build and start the stack (PostgreSQL + NestIdP):

```bash
docker compose up --build -d
```

4. Wait until healthy:

```bash
docker compose ps
curl -sf http://localhost:3000/ready
```

5. Open the admin console at `{IDP_BASE_URL}/admin/login` (with default compose, `http://localhost:3000/admin/login`).

6. Complete operator setup per [RELEASE.md](./RELEASE.md).

The entrypoint runs `prisma migrate deploy` before starting the API. Bootstrap creates the first `AdminUser` when the table is empty and `ADMIN_USERNAME` / `ADMIN_PASSWORD` are set.

---

## Migrations

| Mode                                     | How                                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| **Default (compose / single container)** | Automatic on container start via `scripts/docker-entrypoint.sh`                        |
| **Init container / job only**            | Set `MIGRATE_ONLY=1` — migrations run, process exits **0**, HTTP server does not start |

Kubernetes init container example:

```yaml
initContainers:
	- name: migrate
		image: nestidp:1.0.0
		env:
			- name: MIGRATE_ONLY
				value: '1'
			- name: DATABASE_URL
				valueFrom:
					secretKeyRef:
						name: nestidp-db
						key: url
			- name: DATABASE_PROVIDER
				value: postgresql
			- name: SESSION_SECRET
				valueFrom:
					secretKeyRef:
						name: nestidp-secrets
						key: sessionSecret
			- name: ENCRYPTION_KEY
				valueFrom:
					secretKeyRef:
						name: nestidp-secrets
						key: encryptionKey
```

Host-based deploy (no Docker entrypoint):

```bash
pnpm db:migrate:deploy
NODE_ENV=production node apps/api/dist/main.js
```

---

## Upgrades

1. Back up the database (see below).
2. Pull or rebuild the image.
3. `docker compose up -d` — entrypoint applies new migrations on start.
4. Verify `/ready` and run smoke SSO per [RELEASE.md](./RELEASE.md).

---

## PostgreSQL vs SQLite

| Environment      | `DATABASE_PROVIDER` | Notes                           |
| ---------------- | ------------------- | ------------------------------- |
| Production       | `postgresql`        | Required for compose stack      |
| Local `pnpm dev` | `sqlite` (default)  | File `apps/api/data/nestidp.db` |

`IDP_BASE_URL` must be the **public** URL (browser/SP facing), not internal Docker DNS names like `http://nestidp:3000`.

---

## TLS, reverse proxy, and `TRUST_PROXY`

- Terminate TLS at the load balancer or ingress.
- Set `IDP_BASE_URL` to the HTTPS origin.
- When NestIdP sits behind one reverse proxy hop, set `TRUST_PROXY=true` (or `1`) so `req.ip` reflects the client for rate limits and audit metadata.

---

## Backup and restore (PostgreSQL)

**Secrets warning:** backing up PostgreSQL without also backing up **`ENCRYPTION_KEY`** makes `authCredentialsEncrypted` and IdP private keys unusable after restore with a new key. Store both together in your secrets manager.

### Backup (compose stack running)

```bash
docker compose exec -T postgres pg_dump -U nestidp -d nestidp --format=custom -f /tmp/nestidp.dump
docker compose cp postgres:/tmp/nestidp.dump ./backups/nestidp-$(date +%Y%m%d).dump
```

### Restore (destructive — target DB should be empty or disposable)

```bash
docker compose cp ./backups/nestidp-YYYYMMDD.dump postgres:/tmp/nestidp.dump
docker compose exec -T postgres pg_restore -U nestidp -d nestidp --clean --if-exists /tmp/nestidp.dump
```

### SQLite (development only)

Copy the file:

```bash
cp apps/api/data/nestidp.db ./backups/nestidp-dev-$(date +%Y%m%d).db
```

Not supported for production deployments.

---

## Environment reference (compose / production)

| Variable                                 | Default                 | Purpose                                    |
| ---------------------------------------- | ----------------------- | ------------------------------------------ |
| `DATABASE_PROVIDER`                      | `postgresql` in compose | Prisma engine                              |
| `DATABASE_URL`                           | set in compose          | PostgreSQL connection string               |
| `SESSION_SECRET`                         | —                       | Admin + end-user cookie signing            |
| `ENCRYPTION_KEY`                         | —                       | API tokens and IdP private keys at rest    |
| `IDP_BASE_URL`                           | —                       | Public IdP base URL                        |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD`      | —                       | First admin when table empty               |
| `TRUST_PROXY`                            | `false`                 | `true` behind load balancer                |
| `AUDIT_RETENTION_DAYS`                   | `90`                    | Delete `AuditEvent` rows older than N days |
| `AUDIT_CLEANUP_INTERVAL_MS`              | `86400000`              | Cleanup interval; `0` = once on startup    |
| `ADMIN_USER_CREATE_RATE_LIMIT_MAX`       | `5`                     | Max admin creates per window               |
| `ADMIN_USER_CREATE_RATE_LIMIT_WINDOW_MS` | `900000`                | Admin create rate window (15 min)          |
| `MIGRATE_ONLY`                           | `0`                     | `1` = migrate and exit                     |

See also `.env.docker.example` and root `.env.example` for optional SAML, sync, and login tuning.

---

## Security headers (Helmet)

In `NODE_ENV=production`, the API enables **Helmet** (CSP, frame protection, etc.). SAML POST auto-submit responses are tested to remain compatible. Do not disable Helmet in production without reviewing CSP impact on `/login` and admin static assets.

---

## Health checks

| Endpoint      | Use                                 |
| ------------- | ----------------------------------- |
| `GET /health` | Liveness — always 200 if process up |
| `GET /ready`  | Readiness — 200 when DB connected   |

Configure load balancers to use `/ready` for traffic routing.

---

## Local development without full stack

**API + web on host, PostgreSQL in Docker:**

```bash
# .env: DATABASE_PROVIDER=postgresql, DATABASE_URL=postgresql://nestidp:nestidp@localhost:5432/nestidp
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

**SQLite only (no Docker):** see [development.md](./development.md).

---

## Operator checklist

Before exposing the IdP to end users, complete every item in [RELEASE.md](./RELEASE.md).
