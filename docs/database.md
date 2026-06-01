# Database configuration

NestIdP uses **Prisma** as the ORM. The application code does not branch on a specific database engine — you choose the engine at deploy time via environment variables.

![Database provider workflow](./img/database-providers.svg)

![Entity relationship diagram](./img/schema-entities.svg)

## Supported providers

| `DATABASE_PROVIDER` | Typical use                     | `DATABASE_URL` format                     |
| ------------------- | ------------------------------- | ----------------------------------------- |
| `sqlite`            | **Local development** (default) | `file:../data/nestidp.db`                 |
| `postgresql`        | Production / staging            | `postgresql://user:pass@host:5432/dbname` |

Additional providers (MySQL, etc.) can be added later if the Prisma schema stays portable.

## Domain tables (v0.2.0)

| Model                   | Purpose                                  |
| ----------------------- | ---------------------------------------- |
| `ApiConnection`         | External identity API (sync source)      |
| `User`, `Group`, `Role` | Synced identity store                    |
| `UserGroup`, `UserRole` | Membership join tables                   |
| `SpConnection`          | SAML Service Provider config             |
| `AdminUser`             | Operator accounts (separate from `User`) |
| `SyncLog`               | Sync run history                         |
| `SamlSession`           | In-flight SP-initiated SSO state         |
| `IdpSettings`           | Global IdP singleton (entity ID, certs)  |

See [proposal.MD](./proposal.MD) §9 and the ER diagram above.

### ApiConnection credentials (v0.4.0)

The `authCredentialsEncrypted` column stores **AES-256-GCM** ciphertext of the Bearer token (format `v1:` + base64 payload). Plaintext tokens are never persisted.

- Key material: `SHA-256(ENCRYPTION_KEY)` — see `apps/api/src/encryption/encryption.util.ts`
- **`ENCRYPTION_KEY`** must be at least 16 characters and **stable across restarts** — rotating it invalidates stored tokens (re-create connections or PATCH with a new `bearerToken`)
- API JSON never includes `authCredentialsEncrypted` or decrypted tokens — only `hasBearerToken: boolean`

### Identity sync (v0.5.0)

- **`User.passwordHash`** — synced verbatim from external API (bcrypt); never plaintext
- **`User.email`** — stored normalized (trim + lowercase)
- **`ApiConnection.lastSyncAt`** / **`lastSyncStatus`** — updated by sync engine (not updated on `dryRun`)
- **`SyncLog.errors`** — JSON array of structured entries (`phase`, `message`, optional `httpStatus`, external ids)
- Phases include `dry_run_summary`, `user_limit`, `fetch_users`, `upsert_user`, etc.
- **`durationMs`** appears on API `SyncLogDto` only (computed from timestamps, not persisted)

## Local development (SQLite)

No Docker required:

```bash
cp .env.example .env
mkdir -p apps/api/data
pnpm install   # runs prisma:prepare + prisma generate for sqlite
pnpm db:migrate
pnpm dev
```

SQLite file location (relative to `apps/api/prisma/schema.prisma`):

```
apps/api/data/nestidp.db
```

The file is gitignored. Delete it to reset local data.

`/ready` returns `503 disconnected` until migrations have been applied.

## PostgreSQL (optional local or production)

Start PostgreSQL via Docker profile:

```bash
cp .env.example .env
# Edit .env:
#   DATABASE_PROVIDER=postgresql
#   DATABASE_URL=postgresql://nestidp:nestidp@localhost:5432/nestidp

docker compose --profile postgres up -d
pnpm install
pnpm db:migrate
pnpm dev
```

## How provider selection works

Prisma generates a **provider-specific client** at build/install time. NestIdP therefore:

1. Reads `DATABASE_PROVIDER` from `.env`
2. Runs `pnpm prisma:prepare` — syncs the provider line in `schema.prisma`
3. Runs `prisma generate` / `prisma migrate`

Set **`DATABASE_PROVIDER` and `DATABASE_URL` together**. The API validates that the URL scheme matches the provider on startup.

Root `postinstall` runs **`prisma:generate` only** — not `migrate`. Fresh clones need `pnpm db:migrate`.

## Migrations

| Script                   | When                                                   |
| ------------------------ | ------------------------------------------------------ |
| `pnpm db:migrate`        | Local dev — creates/applies migrations (`migrate dev`) |
| `pnpm db:migrate:deploy` | Production / CI — applies committed migrations only    |

Migration SQL is generated per provider. Dev default creates migrations against **SQLite**. For PostgreSQL deploy: set `DATABASE_PROVIDER=postgresql`, run `prisma:prepare`, then `db:migrate:deploy` on an empty database.

If PostgreSQL migration diverges after a SQLite-first workflow, reset the target database and run `migrate deploy`, or regenerate migrations against a fresh PostgreSQL dev instance.

## First admin bootstrap (v0.3.0)

On API startup, **`BootstrapService`** calls **`runBootstrap`** (same logic as `prisma db seed`):

| Step        | Condition                                                          | Action                                          |
| ----------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| Admin seed  | `ADMIN_USERNAME` + `ADMIN_PASSWORD` set, **zero** `AdminUser` rows | Insert first admin (bcrypt hash)                |
| Admin skip  | One or more admins exist                                           | Skip — password never reset on restart          |
| IdpSettings | No row with `id = default`                                         | Insert singleton with `entityId = IDP_BASE_URL` |

**Idempotency:** restarting the API never duplicates admins or overwrites `entityId`.

**Production:** `NODE_ENV=production` with an empty `AdminUser` table requires a **strong** `ADMIN_PASSWORD` (not `changeme`, minimum 12 characters). Weak or missing credentials fail fast at startup.

**Development:** default `changeme` is allowed with a startup warning.

**Reset local SQLite data:**

```bash
rm -f apps/api/data/nestidp.db
pnpm db:migrate
pnpm dev
```

**Manual seed** (optional, from `apps/api`):

```bash
pnpm exec prisma db seed
```

Prefer API startup bootstrap in production deploys — seed CLI is for local/ops convenience.

![Admin authentication flow](./img/admin-auth-flow.svg)

## Production boot

1. Set `DATABASE_PROVIDER` + `DATABASE_URL`
2. Run migrations: `pnpm db:migrate:deploy`
3. Start API: `node apps/api/dist/main.js`

Docker/Kubernetes: run migrate as an init container or entrypoint step before the app serves traffic. See the comment in `Dockerfile`.

## PostgreSQL integration tests (optional local)

Set `POSTGRES_TEST_URL` to run cross-provider smoke tests locally:

```bash
export POSTGRES_TEST_URL=postgresql://nestidp:nestidp@localhost:5432/nestidp_test
pnpm --filter @nestidp/api test
```

Without this variable, PostgreSQL integration tests are skipped. CI sets it automatically via the Postgres service container.

## Docker production image

Build with provider and URL build-args (PostgreSQL recommended for production):

```bash
docker build \
  --build-arg DATABASE_PROVIDER=postgresql \
  --build-arg DATABASE_URL=postgresql://user:pass@postgres:5432/nestidp \
  -t nestidp .
```

At runtime, set the same variables (or mount secrets) so `/ready` can reach the database.

## Portable schema rules

To keep switching between SQLite and PostgreSQL feasible:

- Avoid `@db.*` provider-specific annotations unless necessary
- Avoid PostgreSQL-only types (arrays, `jsonb`-specific features) in v1 models
- Run `prisma migrate` separately per provider when the schema changes
- Use Prisma Client APIs in services — never raw SQL tied to one engine

See also [development.md](./development.md), [img/README.md](./img/README.md), and [proposal.MD](./proposal.MD).
