# Deployment guide

NestIdP ships as a single Docker image (NestJS API + built React SPA) with an **encrypted libSQL file** as the only datastore — no external database server. Persist the file on a volume and supply an at-rest encryption key.

Related: [RELEASE.md](./RELEASE.md) (go-live checklist) · [database.md](./database.md) · [integration-api.md](./integration-api.md)

---

## Prerequisites

- Docker and Docker Compose (v2)
- Secrets: `SESSION_SECRET`, `ENCRYPTION_KEY`, and `DATABASE_ENCRYPTION_KEY` (≥ 16 characters; generate with `openssl rand -hex 32`)
- A persistent volume for the database file (`apps/api/data/`)
- Public URL for browsers and SAML SPs: `IDP_BASE_URL` (HTTPS in production)
- Optional: TLS-terminating load balancer in front of the container

> **Three independent keys.** `SESSION_SECRET` signs cookies, `ENCRYPTION_KEY` encrypts secret columns (tokens, private keys), and `DATABASE_ENCRYPTION_KEY` encrypts the whole DB file at rest. Back them up together — losing any one makes the corresponding data unrecoverable.

---

## First deploy (Docker Compose)

1. Copy the compose environment template:

```bash
cp .env.docker.example .env.docker
```

2. Edit `.env.docker` — set strong `SESSION_SECRET`, `ENCRYPTION_KEY`, `DATABASE_ENCRYPTION_KEY`, `ADMIN_PASSWORD` (min 12 chars in production), and `IDP_BASE_URL` to the URL users and SPs use (e.g. `https://idp.example.com`).

3. Build and start the stack (the DB file lives on the `nestidp_data` volume):

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

The API applies pending migrations through the keyed libSQL adapter at startup (the encrypted file cannot be opened by the Prisma CLI). Bootstrap creates the first `AdminUser` when the table is empty and `ADMIN_USERNAME` / `ADMIN_PASSWORD` are set.

### Admin session lifetime

| Login choice                     | Cookie behavior                                                                                  | Typical use                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| Default (stay signed in **off**) | Browser **session** cookie (no `Max-Age`); signed validity **8 h** (`ADMIN_SESSION_TTL_SECONDS`) | Shared workstation, daily operator shift |
| **Stay signed in** checked       | Persistent cookie; `ADMIN_SESSION_REMEMBER_TTL_SECONDS` (default **30 days**, max **90 days**)   | Trusted private laptop                   |

**Remember username** stores only the operator name in browser `localStorage` on that device — never the password. Do not enable remember options on shared or public PCs (the login page shows a warning).

After session expiry, the admin UI redirects to `/admin/login?reason=session_expired`.

---

## Migrations

| Mode                                     | How                                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| **Default (compose / single container)** | Automatic at API startup (`main.ts` → `runMigrations`) before the HTTP server listens  |
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
			- name: DATABASE_ENCRYPTION_KEY
				valueFrom:
					secretKeyRef:
						name: nestidp-db
						key: encryptionKey
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

## Database file

| Environment      | `DATABASE_URL`                       | Encryption                                                |
| ---------------- | ------------------------------------ | --------------------------------------------------------- |
| Production       | `file:/app/apps/api/data/nestidp.db` | `DATABASE_ENCRYPTION_KEY` **required**                    |
| Local `pnpm dev` | `file:../data/nestidp.db`            | Optional (key unset → plaintext file for easy inspection) |

Persist the `data/` directory on a volume so the file survives container restarts/upgrades.

`IDP_BASE_URL` must be the **public** URL (browser/SP facing), not internal Docker DNS names like `http://nestidp:3000`.

---

## TLS, reverse proxy, and `TRUST_PROXY`

- Terminate TLS at the load balancer or ingress.
- Set `IDP_BASE_URL` to the HTTPS origin.
- When NestIdP sits behind one reverse proxy hop, set `TRUST_PROXY=true` (or `1`) so `req.ip` reflects the client for rate limits and audit metadata.

---

## Backup and restore

**Secrets warning:** a backup is useless without its keys. Store **`DATABASE_ENCRYPTION_KEY`** (opens the file at all), **`ENCRYPTION_KEY`** (`authCredentialsEncrypted` + IdP private keys), and **`SESSION_SECRET`** together in your secrets manager.

### Consistent encrypted backup (`VACUUM INTO`)

`pnpm db:backup` produces an encrypted copy that is readable only with the same `DATABASE_ENCRYPTION_KEY`:

```bash
docker compose exec nestidp pnpm db:backup -- /app/apps/api/data/backup-$(date +%Y%m%d).db
docker compose cp nestidp:/app/apps/api/data/backup-YYYYMMDD.db ./backups/
```

### Cold copy

With the container stopped (or briefly quiesced), copy the file and its `-wal`/`-shm` siblings together:

```bash
cp apps/api/data/nestidp.db* ./backups/
```

### Restore

Stop the API, put the backup file at `DATABASE_URL`'s path, and start with the matching `DATABASE_ENCRYPTION_KEY`. For a plaintext-dump round-trip (e.g. re-keying or migrating media) use `pnpm db:dump` / `pnpm db:restore` — see [database.md](./database.md#operations-rekey-backup-restore).

### Rekey (rotate the at-rest key)

```bash
docker compose exec nestidp pnpm db:rekey -- "$NEW_KEY"
# then update DATABASE_ENCRYPTION_KEY and restart
```

---

## Environment reference (compose / production)

| Variable                                    | Default        | Purpose                                                                                               |
| ------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                              | set in compose | `file:` path to the libSQL DB file                                                                    |
| `DATABASE_ENCRYPTION_KEY`                   | —              | At-rest DB encryption key (required in prod)                                                          |
| `DATABASE_ENCRYPTION_KEY_FILE`              | —              | Alt: read the DB key from a secret file                                                               |
| `SESSION_SECRET`                            | —              | Admin + end-user cookie signing                                                                       |
| `ENCRYPTION_KEY`                            | —              | API tokens and IdP private keys at rest                                                               |
| `IDP_BASE_URL`                              | —              | Public IdP base URL                                                                                   |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD`         | —              | First admin when table empty                                                                          |
| `TRUST_PROXY`                               | `false`        | `true` behind load balancer                                                                           |
| `AUDIT_RETENTION_DAYS`                      | `90`           | Delete `AuditEvent` rows older than N days                                                            |
| `AUDIT_CLEANUP_INTERVAL_MS`                 | `86400000`     | Cleanup interval; `0` = once on startup                                                               |
| `ADMIN_USER_CREATE_RATE_LIMIT_MAX`          | `5`            | Max admin creates per window                                                                          |
| `ADMIN_USER_CREATE_RATE_LIMIT_WINDOW_MS`    | `900000`       | Admin create rate window (15 min)                                                                     |
| `MIGRATE_ONLY`                              | `0`            | `1` = migrate and exit                                                                                |
| `SYNC_SCHEDULER_TICK_MS`                    | `30000`        | Scheduled-sync tick interval; `0` disables the scheduler                                              |
| `SYNC_SCHEDULE_MIN_INTERVAL_MINUTES`        | `5`            | Reject cron schedules firing more often than this                                                     |
| `SYNC_SCHEDULE_JITTER_MAX_SECONDS`          | `30`           | Spread same-cron connections; `0` = exact run times                                                   |
| `SYNC_SCHEDULE_FAILURE_AUTOPAUSE_THRESHOLD` | `0`            | Auto-pause after N consecutive failures; `0` = never                                                  |
| `SYNC_SCHEDULE_BOOT_OVERDUE_GRACE_MINUTES`  | `0`            | On boot, run an overdue schedule only if overdue ≤ N min; `0` = never                                 |
| `PROXY_CONNECT_TIMEOUT_MS`                  | `5000`         | Per-connection outbound `ProxyAgent` connect timeout (fast-fail a dead proxy); bounded `[100, 60000]` |

> **Single-instance scheduling.** The scheduled-sync scheduler is **in-process** and assumes a single
> NestIdP container. Running multiple replicas would **double-run** schedules (no HA leader election).
> For a multi-replica deployment, keep the scheduler on exactly one instance and set
> `SYNC_SCHEDULER_TICK_MS=0` on the others.

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

**Hot reload in Docker (Nest watch + Vite HMR):**

```bash
cp .env.docker.example .env.docker
pnpm dev:docker
# Browser: http://localhost:5173 (SPA) — API: http://localhost:3000
```

**API + web on host (no Docker, no DB server):**

```bash
# .env: DATABASE_URL=file:../data/nestidp.db (DATABASE_ENCRYPTION_KEY optional in dev)
pnpm db:migrate:deploy
pnpm dev
```

See [development.md](./development.md) for details.

---

## Operator checklist

Before exposing the IdP to end users, complete every item in [RELEASE.md](./RELEASE.md).
