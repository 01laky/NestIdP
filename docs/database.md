# Database configuration

NestIdP uses **Prisma** as the ORM on top of a single embedded engine: an **encrypted libSQL file** (SQLite-compatible). There is no external database server — the whole identity store is one file on a mounted volume, encrypted at rest.

![Entity relationship diagram](./img/schema-entities.svg)

## Storage model

| Setting                        | Value                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                 | `file:` URL only (e.g. `file:../data/nestidp.db`)                                              |
| `DATABASE_ENCRYPTION_KEY`      | At-rest key, inline. **Required in production.**                                               |
| `DATABASE_ENCRYPTION_KEY_FILE` | Alternative: read the key from a mounted secret file. Mutually exclusive with the inline form. |

The database file is opened through the **`@prisma/adapter-libsql`** driver adapter with the `encryptionKey` set. This is the only way to read an encrypted libSQL file — Prisma's bundled SQLite engine and the `prisma migrate`/`prisma db` CLIs **cannot** open it. Migrations are therefore applied by an in-process migrator at startup (see [Migrations](#migrations)).

> **At-rest encryption only.** This protects the file on disk/backup media. It is independent of the app-layer **`ENCRYPTION_KEY`** (which encrypts individual secret columns like bearer tokens and private keys).

![Encrypted libSQL adapter and startup migration workflow](./img/database-providers.svg)

## Domain tables (v1.0.0)

| Model                   | Purpose                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| `ApiConnection`         | External identity API (sync source) + hidden **local directory** row |
| `User`, `Group`, `Role` | Identity store (`origin`: `SYNCED` or `MANUAL`)                      |
| `UserGroup`, `UserRole` | Membership join tables                                               |
| `SpConnection`          | SAML Service Provider config                                         |
| `AdminUser`             | Operator accounts (separate from `User`)                             |
| `SyncLog`               | Sync run history (detailed sync errors)                              |
| `AuditEvent`            | Persistent security/config audit trail                               |
| `SamlSession`           | In-flight SP-initiated SSO state                                     |
| `IdpSettings`           | Global IdP singleton (entity ID, certs)                              |

See [proposal.MD](./proposal.MD) §9 and the ER diagram above.

### ApiConnection credentials (v0.4.0)

The `authCredentialsEncrypted` column stores **AES-256-GCM** ciphertext of the Bearer token (format `v1:` + base64 payload). Plaintext tokens are never persisted.

- Key material: `SHA-256(ENCRYPTION_KEY)` — see `apps/api/src/encryption/encryption.util.ts`
- **`ENCRYPTION_KEY`** must be at least 16 characters and **stable across restarts** — rotating it invalidates stored tokens (re-create connections or PATCH with a new `bearerToken`)
- API JSON never includes `authCredentialsEncrypted` or decrypted tokens — only `hasBearerToken: boolean`

### Manual identity (v1.2.0)

| Field / model                                | Purpose                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ApiConnection.isLocalDirectory`             | Bootstrap **Local directory** row (`name` constant in shared); excluded from operator list; not syncable |
| `User.origin`, `Group.origin`, `Role.origin` | `SYNCED` (API sync) or `MANUAL` (admin CRUD); sync never deactivates/deletes/overwrites `MANUAL`         |
| Manual `externalId`                          | Server-generated `manual:user:<id>`, `manual:group:<id>`, `manual:role:<id>`                             |

Migration: `20260604120000_identity_manual_crud` (single history under `prisma/migrations/`).

### Identity sync (v0.5.0)

- **`User.passwordHash`** — synced verbatim from external API (bcrypt); never plaintext
- **`User.email`** — stored normalized (trim + lowercase)
- **`ApiConnection.lastSyncAt`** / **`lastSyncStatus`** — updated by sync engine (not updated on `dryRun`)
- **`SyncLog.errors`** — JSON array of structured entries (`phase`, `message`, optional `httpStatus`, external ids)
- Phases include `dry_run_summary`, `user_limit`, `fetch_users`, `upsert_user`, etc.
- **`durationMs`** appears on API `SyncLogDto` only (computed from timestamps, not persisted)

### End-user sessions (v0.6.0)

- **`AdminUser`** and **`User`** are separate tables — same username string may exist in both without conflict
- End-user auth uses cookie **`nestidp_user_session`** (HMAC-signed with `SESSION_SECRET`) — not stored in DB
- Admin uses **`nestidp_admin_session`** — separate cookie and session payload (includes CSRF)
- **`SamlSession.userId`** — set after successful login when `samlSessionId` is provided (SSO bind)

### IdpSettings and certificate rotation (v0.9.0)

Singleton row `id = default`. Bootstrap creates **`entityId`** only (from `IDP_BASE_URL`); signing certs are operator-managed or lazy-generated on first SSO/metadata (dev fallback).

| Column                                                                                                      | Purpose                                                                   |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `signingCertPem` / `signingKeyEncrypted`                                                                    | Primary signing material (assertions + metadata)                          |
| `pendingSigningCertPem` / `pendingSigningKeyEncrypted`                                                      | Next cert during rotation (metadata only until complete)                  |
| `rotationStartedAt`                                                                                         | UI / audit timestamp when signing rotation started                        |
| `signingKeyFamily`, `signingSignatureAlgorithmId`, …                                                        | Crypto metadata for primary/pending signing certs (v1.4.7)                |
| `encryptionCertPem` / `encryptionKeyEncrypted`                                                              | Optional IdP encryption material (metadata `use="encryption"`)            |
| `pendingEncryptionCertPem` / `pendingEncryptionKeyEncrypted`                                                | Next encryption cert during encryption rotation                           |
| `encryptionRotationStartedAt`                                                                               | Timestamp when **encryption** rotation started (independent from signing) |
| `encryptionKeyFamily`, `encryptionKeyTransportAlgorithmId`, `encryptionRsaModulusBits`, `encryptionEcCurve` | Primary encryption crypto metadata (v1.5.0)                               |
| `pendingEncryption*` columns                                                                                | Pending encryption crypto during rotation                                 |

**Invariants:** for each rotation kind (signing vs encryption), pending cert and key must both be set or both null; `complete` promotes pending → primary including crypto columns; `cancel` clears pending fields. Signing and encryption rotations may be active **at the same time**. Encryption cert is **never** lazy-generated on SSO. Private keys encrypted with `EncryptionService` (`v1:` prefix).

**SpConnection (v1.5.0+):** `wantAssertionsEncrypted` defaults `false`; API rejects enabling without `spCertificate` PEM. When true (v1.7.0), SSO encrypts signed assertions to the SP cert (AES-256-CBC).

Deploy: migrations through `20260605130000_idp_encryption_crypto` are applied automatically at API startup (or via `pnpm db:migrate:deploy`).

### Audit events (v1.0.0)

Operator and security events are stored in **`AuditEvent`** (separate from **`SyncLog`**).

| Column                      | Purpose                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `category`                  | `admin_auth`, `admin_config`, `end_user_auth`, `saml`, `sync`, `identity` (v1.2.0) |
| `event`                     | Stable machine name (e.g. `admin_login_success`, `sync_completed`)                 |
| `actorType`                 | `admin`, `end_user`, or `system`                                                   |
| `actorId` / `actorLabel`    | Who performed the action (username in label; never passwords)                      |
| `subjectType` / `subjectId` | Optional target entity (e.g. `ApiConnection`, `AdminUser`)                         |
| `clientIp`                  | Client IP when available (`TRUST_PROXY` affects accuracy behind LB)                |
| `metadata`                  | Small JSON extras (sanitized; max ~4 KB; no secrets)                               |
| `createdAt`                 | Event timestamp                                                                    |

**Retention:** `AuditRetentionCleanupService` deletes rows older than `AUDIT_RETENTION_DAYS` (default 90). **`SyncLog`** is not purged by this job.

**Migration:** `20260603120000_audit_events`.

Dual-write: events also appear in container stdout for log aggregation.

## Local development

No Docker, no database server required:

```bash
cp .env.example .env
mkdir -p apps/api/data
pnpm install   # runs prisma generate
pnpm db:migrate:deploy   # applies migrations to the local file
pnpm dev
```

Database file location (relative to `apps/api/prisma/schema.prisma`):

```
apps/api/data/nestidp.db
```

The file is gitignored. Delete it (and any `-wal`/`-shm` siblings) to reset local data. In development `DATABASE_ENCRYPTION_KEY` is optional — without it the file is a plain, unencrypted SQLite file (handy for inspecting with standard tooling). Set the key to exercise the encrypted path locally.

`/ready` returns `503 disconnected` until migrations have been applied.

## Migrations

Because the encrypted file cannot be opened by the Prisma CLI, NestIdP splits migration **authoring** from **applying**:

| Script                   | When                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:new-migration`  | Author a new migration. Runs `prisma migrate dev` against an unencrypted scratch DB (`prisma/.scratch.db`, gitignored) to generate the SQL. |
| `pnpm db:migrate:deploy` | Apply committed, pending migrations to the real (possibly encrypted) file through the libSQL adapter.                                       |

At runtime the API applies pending migrations itself on boot (`main.ts` → `runMigrations`) before it starts listening. Set **`MIGRATE_ONLY=1`** to apply migrations and exit (init-container / job pattern).

The migrator (`apps/api/src/prisma/db-migrator.ts`):

- Tracks applied migrations in an **`__app_migrations`** table (`name`, `checksum`, `applied_at`).
- Applies all pending migrations as **one atomic batch** inside `BEGIN IMMEDIATE` — a failure rolls back the whole batch (nothing partially recorded).
- Detects **drift**: if an already-applied `migration.sql` changed on disk (checksum mismatch), it refuses to continue.
- Runs a SQLite **integrity check** and distinguishes a wrong/missing key from a corrupt file.

There is a single committed history under **`prisma/migrations/`** (sqlite dialect).

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

**Reset local data:**

```bash
rm -f apps/api/data/nestidp.db apps/api/data/nestidp.db-wal apps/api/data/nestidp.db-shm
pnpm db:migrate:deploy
pnpm dev
```

**Manual seed** (optional, from `apps/api`):

```bash
pnpm exec prisma db seed
```

Prefer API startup bootstrap in production deploys — seed CLI is for local/ops convenience.

![Admin authentication flow](./img/admin-auth-flow.svg)

## Production boot

1. Set `DATABASE_URL` (a `file:` path on a persistent volume) and **`DATABASE_ENCRYPTION_KEY`** (or `DATABASE_ENCRYPTION_KEY_FILE`) — the key is **required** in production.
2. Migrations apply automatically at startup. To run them as a separate step/job, use `MIGRATE_ONLY=1` (or `pnpm db:migrate:deploy`).
3. Start API: `node apps/api/dist/main.js` (or `docker compose up`).

See [deployment.md](./deployment.md) for Compose, key management, and backups, and [RELEASE.md](./RELEASE.md) for go-live checks.

## Operations: rekey, backup, restore

The `db-cli.mjs` helper opens the file through the libSQL adapter with the current key:

| Script            | Action                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------- |
| `pnpm db:rekey`   | `PRAGMA rekey` — re-encrypt the file in place with a new key (rotate the at-rest key). |
| `pnpm db:backup`  | `VACUUM INTO` — produce an encrypted copy (readable only with the same key).           |
| `pnpm db:dump`    | Export a plaintext `.sql` dump (handle carefully — this is unencrypted).               |
| `pnpm db:restore` | Recreate a database file from a `.sql` dump (optionally with a new encryption key).    |

Key rotation outline: take a backup, run `pnpm db:rekey` with the new key, then update `DATABASE_ENCRYPTION_KEY` and restart. A wrong key surfaces as a clear integrity error at startup rather than silent corruption.

## Tests

Each spec applies migrations to its own temporary file via the in-process migrator — there is no external database and no `prisma migrate deploy` in the test path. Tests run against unencrypted temp files; dedicated specs cover the encrypted path, rekey, and backup.

See also [development.md](./development.md), [img/README.md](./img/README.md), and [proposal.MD](./proposal.MD).
