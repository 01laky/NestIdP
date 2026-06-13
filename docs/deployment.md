# Deployment guide

NestIdP ships as a single Docker image (NestJS API + built React SPA) with an **encrypted libSQL file** as the only datastore — no external database server. Persist the file on a volume and supply an at-rest encryption key.

Deployment artifacts (compose files, env templates) live in **`deploy/`**. `Dockerfile` and `Dockerfile.dev` stay in the repo root per Docker convention. See [`deploy/README.md`](../deploy/README.md) for a quick-reference summary.

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

1. Copy the prod env template and fill in secrets:

```bash
cp deploy/.env.docker.prod.example deploy/.env.docker.prod
# Edit deploy/.env.docker.prod — set SESSION_SECRET, ENCRYPTION_KEY,
# DATABASE_ENCRYPTION_KEY (openssl rand -hex 32 for each),
# ADMIN_PASSWORD (min 12 chars), IDP_BASE_URL (must be HTTPS in production)
```

2. Build and start the stack (the DB file lives on the `nestidp_data` named volume):

```bash
pnpm docker:prod
```

3. Wait until healthy:

```bash
pnpm docker:prod:logs          # follow startup logs
curl -sf http://localhost:3000/ready
```

4. Open the admin console at `{IDP_BASE_URL}/admin/login`.

5. Complete operator setup per [RELEASE.md](./RELEASE.md).

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
3. Optional — run migrations only before bringing up the new container: `pnpm docker:prod:migrate`
4. `pnpm docker:prod` — entrypoint applies any remaining migrations on start.
5. Verify `/ready` and run smoke SSO per [RELEASE.md](./RELEASE.md).

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
docker compose -f deploy/docker-compose.prod.yml exec nestidp pnpm db:backup -- /app/apps/api/data/backup-$(date +%Y%m%d).db
docker compose -f deploy/docker-compose.prod.yml cp nestidp:/app/apps/api/data/backup-YYYYMMDD.db ./backups/
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
docker compose -f deploy/docker-compose.prod.yml exec nestidp pnpm db:rekey -- "$NEW_KEY"
# then update DATABASE_ENCRYPTION_KEY in deploy/.env.docker.prod and restart
```

---

## Environment reference (compose / production)

| Variable                                             | Default                     | Purpose                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                       | set in compose              | `file:` path to the libSQL DB file                                                                                                                                                                                                                                                                                                             |
| `DATABASE_ENCRYPTION_KEY`                            | —                           | At-rest DB encryption key (required in prod)                                                                                                                                                                                                                                                                                                   |
| `DATABASE_ENCRYPTION_KEY_FILE`                       | —                           | Alt: read the DB key from a secret file                                                                                                                                                                                                                                                                                                        |
| `SESSION_SECRET`                                     | —                           | Admin + end-user cookie signing                                                                                                                                                                                                                                                                                                                |
| `ENCRYPTION_KEY`                                     | —                           | API tokens and IdP private keys at rest                                                                                                                                                                                                                                                                                                        |
| `IDP_BASE_URL`                                       | —                           | Public IdP base URL                                                                                                                                                                                                                                                                                                                            |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD`                  | —                           | First admin when table empty                                                                                                                                                                                                                                                                                                                   |
| `TRUST_PROXY`                                        | `false`                     | `true` behind load balancer                                                                                                                                                                                                                                                                                                                    |
| `AUDIT_RETENTION_DAYS`                               | `90`                        | Delete `AuditEvent` rows older than N days                                                                                                                                                                                                                                                                                                     |
| `AUDIT_CLEANUP_INTERVAL_MS`                          | `86400000`                  | Cleanup interval; `0` = once on startup                                                                                                                                                                                                                                                                                                        |
| `ADMIN_USER_CREATE_RATE_LIMIT_MAX`                   | `5`                         | Max admin creates per window                                                                                                                                                                                                                                                                                                                   |
| `ADMIN_USER_CREATE_RATE_LIMIT_WINDOW_MS`             | `900000`                    | Admin create rate window (15 min)                                                                                                                                                                                                                                                                                                              |
| `MIGRATE_ONLY`                                       | `0`                         | `1` = migrate and exit                                                                                                                                                                                                                                                                                                                         |
| `SYNC_SCHEDULER_TICK_MS`                             | `30000`                     | Scheduled-sync tick interval; `0` disables the scheduler                                                                                                                                                                                                                                                                                       |
| `SYNC_SCHEDULE_MIN_INTERVAL_MINUTES`                 | `5`                         | Reject cron schedules firing more often than this                                                                                                                                                                                                                                                                                              |
| `SYNC_SCHEDULE_JITTER_MAX_SECONDS`                   | `30`                        | Spread same-cron connections; `0` = exact run times                                                                                                                                                                                                                                                                                            |
| `SYNC_SCHEDULE_FAILURE_AUTOPAUSE_THRESHOLD`          | `0`                         | Auto-pause after N consecutive failures; `0` = never                                                                                                                                                                                                                                                                                           |
| `SYNC_SCHEDULE_BOOT_OVERDUE_GRACE_MINUTES`           | `0`                         | On boot, run an overdue schedule only if overdue ≤ N min; `0` = never                                                                                                                                                                                                                                                                          |
| `PROXY_CONNECT_TIMEOUT_MS`                           | `5000`                      | Per-connection outbound `ProxyAgent` connect timeout (fast-fail a dead proxy); bounded `[100, 60000]`                                                                                                                                                                                                                                          |
| `CERT_ROTATION_SCHEDULER_TICK_MS`                    | `3600000`                   | Automatic cert-rotation tick interval; `0` disables the scheduler (manual rotation only)                                                                                                                                                                                                                                                       |
| `CERT_ROTATION_LEAD_DAYS`                            | `30`                        | Auto-start a rotation when the active cert expires within N days (per-cert `…_SIGNING_/…_ENCRYPTION_` overrides)                                                                                                                                                                                                                               |
| `CERT_ROTATION_OVERLAP_DAYS`                         | `7`                         | Auto-complete only after the pending cert has been published N days (clamped to fit before expiry)                                                                                                                                                                                                                                             |
| `CERT_ROTATION_VALIDITY_DAYS`                        | `365`                       | Validity of auto-generated rotation certs                                                                                                                                                                                                                                                                                                      |
| `CERT_ROTATION_NOTIFY_LEAD_DAYS`                     | `45`                        | Fire the "due soon" notifier this far ahead of the auto-start window                                                                                                                                                                                                                                                                           |
| `CERT_ROTATION_JITTER_MAX_SECONDS`                   | `0`                         | Random spread before an auto-start; `0` = exact                                                                                                                                                                                                                                                                                                |
| `CERT_ROTATION_BOOT_GRACE_HOURS`                     | `0`                         | On boot, auto-start immediately only if the cert expires within N hours; else wait a tick                                                                                                                                                                                                                                                      |
| `CERT_ROTATION_FAILURE_AUTODISABLE_THRESHOLD`        | `5`                         | Auto-disable a cert's auto-rotation after N consecutive failures; `0` = never                                                                                                                                                                                                                                                                  |
| `CERT_ROTATION_DRY_RUN`                              | `false`                     | Evaluate + audit/notify what would happen without mutating                                                                                                                                                                                                                                                                                     |
| `LOGIN_LOCKOUT_THRESHOLD`                            | `5`                         | Consecutive failures before account lockout; `0` disables lockout (per-scope `ADMIN_`/`END_USER_` overrides)                                                                                                                                                                                                                                   |
| `LOGIN_LOCKOUT_BASE_MS`                              | `900000`                    | First lock duration; doubles per extra failure                                                                                                                                                                                                                                                                                                 |
| `LOGIN_LOCKOUT_MAX_MS`                               | `86400000`                  | Backoff clamp; lockout is always finite (never permanent)                                                                                                                                                                                                                                                                                      |
| `LOGIN_LOCKOUT_RESPONSE_MODE`                        | `retry_after`               | `retry_after` (429 + `Retry-After`) or `opaque` (generic 401, no lockout disclosure)                                                                                                                                                                                                                                                           |
| `LOGIN_LOCKOUT_PRUNE_INTERVAL_MS`                    | `3600000`                   | Sweep of stale lockout rows; `0` disables                                                                                                                                                                                                                                                                                                      |
| `ADMIN_LOGIN_RATE_LIMIT_MAX` / `_WINDOW_MS`          | `10` / `900000`             | Admin login per-IP throttle (now configurable)                                                                                                                                                                                                                                                                                                 |
| `ADMIN_LOGIN_RATE_LIMIT_USERNAME_MAX` / `_WINDOW_MS` | `5` / `900000`              | Admin login per-username throttle (new, parity with end-user)                                                                                                                                                                                                                                                                                  |
| `SAML_SSO_RATE_IP_MAX` / `_WINDOW_MS`                | `60` / `900000`             | Per-IP throttle on `/saml/sso` (closes the previously-unthrottled gap)                                                                                                                                                                                                                                                                         |
| `LOGIN_IP_BAN_THRESHOLD` / `_WINDOW_MS` / `_MS`      | `10` / `900000` / `3600000` | Cross-endpoint per-IP escalation/ban; threshold `0` disables                                                                                                                                                                                                                                                                                   |
| `RATE_LIMIT_TRUSTED_CIDRS`                           | _(none)_                    | CIDRs/IPs exempt from throttle + IP ban (never from account lockout)                                                                                                                                                                                                                                                                           |
| `LOGIN_TARPIT_BASE_MS`                               | `0`                         | Optional progressive delay before a failed-login response; `0` = off                                                                                                                                                                                                                                                                           |
| `SAML_BACKCHANNEL_LOGOUT_SCHEDULER_TICK_MS`          | `30000`                     | Back-channel (SOAP) SLO retry tick; `0` disables retries (synchronous first pass only)                                                                                                                                                                                                                                                         |
| `SAML_BACKCHANNEL_LOGOUT_HTTP_TIMEOUT_MS`            | `5000`                      | Per-delivery outbound SOAP timeout; bounded `[1000, 60000]`                                                                                                                                                                                                                                                                                    |
| `SAML_BACKCHANNEL_LOGOUT_MAX_RETRIES`                | `5`                         | Retry attempts after the first pass before `given_up`; bounded `[0, 50]` (`0` = first pass only)                                                                                                                                                                                                                                               |
| `SAML_BACKCHANNEL_LOGOUT_RETRY_BASE_MS`              | `30000`                     | Exponential backoff base (`× 2^attempt`, clamped by `…_RETRY_MAX_MS`)                                                                                                                                                                                                                                                                          |
| `SAML_BACKCHANNEL_LOGOUT_RETRY_MAX_MS`               | `3600000`                   | Backoff clamp for retries                                                                                                                                                                                                                                                                                                                      |
| `SAML_BACKCHANNEL_LOGOUT_CONCURRENCY`                | `5`                         | Max parallel deliveries per tick; bounded `[1, 100]`                                                                                                                                                                                                                                                                                           |
| `SAML_BACKCHANNEL_LOGOUT_MAX_INFLIGHT`               | `20`                        | Global in-flight cap so a mass terminate cannot flood SPs; bounded `[1, 1000]`                                                                                                                                                                                                                                                                 |
| `SAML_BACKCHANNEL_LOGOUT_FIRST_PASS_BUDGET_MS`       | `4000`                      | Wall-clock budget for the inline first pass; the rest falls to the retry queue (`0` = no inline pass)                                                                                                                                                                                                                                          |
| `SAML_BACKCHANNEL_LOGOUT_VALIDITY_S`                 | `300`                       | Outbound LogoutRequest `NotOnOrAfter` window (seconds); bounded `[30, 3600]`                                                                                                                                                                                                                                                                   |
| `SAML_BACKCHANNEL_LOGOUT_PRUNE_INTERVAL_MS`          | `3600000`                   | Sweep of resolved queue rows; `0` disables                                                                                                                                                                                                                                                                                                     |
| `SAML_BACKCHANNEL_LOGOUT_PRUNE_RETENTION_MS`         | `604800000`                 | Delete resolved rows older than this in the prune sweep                                                                                                                                                                                                                                                                                        |
| `SYNC_USERNAME_COLLISION_POLICY`                     | `skip`                      | Cross-connection username collision policy (`skip` keeps the run successful; `fail_run` fails the colliding run); per-connection override available                                                                                                                                                                                            |
| `SYNC_ALL_CONCURRENCY`                               | `1`                         | Max connections synced concurrently by "Sync all"; `1` = sequential (deterministic collision winner); bounded `[1, 16]`. Values `> 1` are honoured only when **every** included connection uses the `fail_run` collision policy — otherwise clamped to `1` with a warning (the first-connection-wins order is only deterministic sequentially) |
| `SYNC_SOURCE_STALE_FACTOR`                           | `3`                         | Dashboard marks a scheduled source "overdue" when `lastSyncAt` is older than cron interval × this factor; bounded `[1, 50]`                                                                                                                                                                                                                    |
| `IDP_SETTINGS_CACHE_TTL_MS`                          | `5000`                      | In-process TTL for `GET /api/admin/idp/settings` cache (cert panel re-reads); `0` disables caching                                                                                                                                                                                                                                             |
| `PORT`                                               | `3000`                      | HTTP port the NestJS server listens on; override when the container port mapping must differ                                                                                                                                                                                                                                                   |
| `BUILD_GIT_SHA`                                      | _(none)_                    | Inject the build commit SHA (e.g. via `--build-arg`); appears as `gitSha` in `/health` responses                                                                                                                                                                                                                                               |

> **Single-instance scheduling.** The scheduled-sync scheduler is **in-process** and assumes a single
> NestIdP container. Running multiple replicas would **double-run** schedules (no HA leader election).
> For a multi-replica deployment, keep the scheduler on exactly one instance and set
> `SYNC_SCHEDULER_TICK_MS=0` on the others.

> **Brute-force protection is single-instance too.** The per-IP / per-username **throttle** and the per-IP
> **ban** keep state in memory (per replica), so under multiple replicas each enforces its own counters.
> The persistent per-account **lockout** is shared via the DB and behaves consistently across replicas and
> restarts. Set `LOGIN_LOCKOUT_THRESHOLD=0` to disable lockout, or `LOGIN_LOCKOUT_RESPONSE_MODE=opaque`
> to hide lockout from clients entirely.

> **Back-channel SLO is single-instance too.** The retry scheduler is **in-process**. Logout is always
> authoritative locally; SOAP propagation to SPs is best-effort with persistent, restart-surviving retries.
> Multiple replicas would **double-send** LogoutRequests — keep the scheduler on exactly one instance and
> set `SAML_BACKCHANNEL_LOGOUT_SCHEDULER_TICK_MS=0` on the others (the synchronous first pass still runs).

See also `deploy/.env.docker.prod.example` and root `.env.example` for optional SAML, sync, and login tuning.

---

## Security headers (Helmet)

In `NODE_ENV=production`, the API enables **Helmet** (CSP, frame protection, etc.). SAML POST auto-submit responses are tested to remain compatible. Do not disable Helmet in production without reviewing CSP impact on `/login` and admin static assets.

---

## Health and readiness probes

| Endpoint      | HTTP          | Use case                                                          |
| ------------- | ------------- | ----------------------------------------------------------------- |
| `GET /health` | `200`         | **Liveness** — always 200 if the process is alive; never calls DB |
| `GET /ready`  | `200` / `503` | **Readiness** — 200 when DB connected, 503 otherwise              |

Configure your load balancer or orchestrator to use `/ready` for traffic routing and `/health` for restart decisions.

### `/health` response shape

```json
{
	"status": "ok",
	"version": "1.20.0",
	"gitSha": "ddf82ce",
	"uptimeSeconds": 3721,
	"audit": {
		"persistFailures": 0,
		"lastPersistFailureAt": null
	},
	"schedulers": {
		"sync": { "lastTickAt": "2026-05-20T08:16:00.000Z", "lastProcessed": 1 },
		"certRotation": { "lastTickAt": "2026-05-20T08:00:00.000Z", "lastProcessed": 0 },
		"backchannel": { "lastTickAt": "2026-05-20T08:16:00.000Z", "lastProcessed": 0 }
	}
}
```

`schedulers.*` fields are `null` before the first tick. Alert when `lastTickAt` is older than 2× the tick interval or is `null` after startup. `audit.persistFailures` incrementing means DB writes are silently failing — investigate connectivity.

### `/ready` response shape

```json
{
	"status": "connected",
	"migrations": { "applied": 18, "available": 18, "upToDate": true }
}
```

`status` is one of `connected`, `disconnected`, `not_configured`. `upToDate: false` means pending migrations — restart with a newer image or run `pnpm db:migrate:deploy`.

Configure load balancers to use `/ready` for traffic routing.

---

## Local development

### Env file overview

| File                      | Template                          | Used by                      | Committed? |
| ------------------------- | --------------------------------- | ---------------------------- | ---------- |
| `deploy/.env.docker.prod` | `deploy/.env.docker.prod.example` | `pnpm docker:prod`           | No         |
| `deploy/.env.docker.dev`  | `deploy/.env.docker.dev.example`  | `pnpm docker:dev`            | No         |
| `.env`                    | `.env.example`                    | `pnpm dev` (host, no Docker) | No         |

### DB storage per environment

| Environment        | Location                                              | Managed by                                                  |
| ------------------ | ----------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm docker:prod` | Docker named volume `nestidp_data`                    | Docker (survives `down`, removed by `docker:prod:reset`)    |
| `pnpm docker:dev`  | Host file `apps/api/data/nestidp.db` (via bind-mount) | Git-ignored; inspect directly on host                       |
| `pnpm dev` (host)  | Host file `apps/api/data/nestidp.db`                  | Same path as docker dev — shared if both run from same repo |

> **Running both docker:prod and docker:dev simultaneously is not supported** — both expose port `3000` and will conflict. Stop one before starting the other.

### Hot reload in Docker (Nest watch + Vite HMR)

```bash
cp deploy/.env.docker.dev.example deploy/.env.docker.dev   # pre-filled — nothing to edit
pnpm docker:dev
# Admin SPA: http://localhost:5173/admin/login  |  API: http://localhost:3000
```

### API + web on host (no Docker, no DB server)

```bash
# .env: DATABASE_URL=file:../data/nestidp.db (DATABASE_ENCRYPTION_KEY optional in dev)
pnpm db:migrate:deploy
pnpm dev
```

### Useful shortcuts

| Task                            | Command                    |
| ------------------------------- | -------------------------- |
| Follow dev logs                 | `pnpm docker:dev:logs`     |
| Open shell in dev container     | `pnpm docker:dev:shell`    |
| Wipe dev volumes (node_modules) | `pnpm docker:dev:reset`    |
| Follow prod logs                | `pnpm docker:prod:logs`    |
| Run prod migrations only        | `pnpm docker:prod:migrate` |
| Wipe prod DB volume             | `pnpm docker:prod:reset`   |

See [development.md](./development.md) for the full local dev guide.

---

---

## Troubleshooting

### `/ready` returns 503 after startup

The DB file is missing, `DATABASE_URL` is unset, or migrations have not run. Confirm:

```bash
# Check migration status
curl http://localhost:3000/ready
# Expected: { "status": "connected", "migrations": { "upToDate": true } }
```

If `status: disconnected`, verify `DATABASE_URL` points to a writable path and `DATABASE_ENCRYPTION_KEY` is set (required in production).

### Admin login returns 401 "Invalid credentials"

- `ADMIN_USERNAME` / `ADMIN_PASSWORD` bootstrap values were changed; use the password set on the admin account.
- The bootstrap only runs when the `AdminUser` table is **empty**. If the admin was already created with a different password, use the login page to sign in or reset via `PATCH /api/admin/admin-users/:id`.

### Users cannot log in after a successful sync

- `passwordHashAlgorithm` returned by the external API is not `"bcrypt"` — check `SyncLog.errors` on the sync page.
- `User.active` is `false` — the user was deactivated in the latest sync snapshot.
- Username is case-sensitive: `Alice` ≠ `alice`. Verify the username entered matches the stored `User.username` exactly.

### Account locked — user cannot log in

Accounts lock after `LOGIN_LOCKOUT_THRESHOLD` consecutive failures. The lockout is DB-persisted (not in-memory) and survives restarts. It expires automatically after the backoff window. To recover immediately, operators can unlock an account from the admin console (if available) or wait for the lock to expire. The maximum lock duration is `LOGIN_LOCKOUT_MAX_MS` (default 24 h). To disable lockout entirely, set `LOGIN_LOCKOUT_THRESHOLD=0`.

### SAML assertions rejected by the SP

- The SP's trust store must include the IdP's current signing certificate fingerprint. Download the updated metadata from `{IDP_BASE_URL}/saml/metadata` and re-import into the SP.
- During certificate rotation the metadata publishes **two** `KeyDescriptor` entries. Some SPs require a metadata re-import to pick up the pending cert before rotation completes.
- Clock skew: IdP and SP clocks must be within `SAML_CLOCK_SKEW_SECONDS` (default 120 s) of each other.

### Scheduled sync not running

- Confirm `SYNC_SCHEDULER_TICK_MS` is not `0` (disabled).
- Check the `/health` response: `schedulers.sync.lastTickAt` must be within the last 2× tick intervals.
- On multi-replica deploys, only one instance should have `SYNC_SCHEDULER_TICK_MS > 0`.

### Encrypted DB fails to open after key rotation

A `DATABASE_ENCRYPTION_KEY` change requires re-keying the database before swapping the key. Use `pnpm db:rekey` **before** updating the env var, or restore from a backup taken with the old key. Losing the key makes the file permanently unreadable — store it in a secrets manager alongside a recent backup.

---

## Operator checklist

Before exposing the IdP to end users, complete every item in [RELEASE.md](./RELEASE.md).
