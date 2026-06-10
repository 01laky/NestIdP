# Database migrations

NestIdP applies its **local (libSQL/SQLite) schema migrations itself** at boot — see
`apps/api/src/prisma/db-migrator.ts`. Prisma is used to _author_ migrations
(`pnpm db:new-migration`), but the runtime migrator is a small custom applier that supports the
encrypted libSQL database, concurrent-boot locking (`BEGIN IMMEDIATE`), checksum drift detection and
an idempotent tracking table (`__app_migrations`).

## The one-statement-per-`;` constraint (read before writing a migration)

The migrator splits each `migration.sql` into statements with a **naive comment-stripped split on
`;`** (`splitSqlStatements`). That is deliberate — libSQL's `executeMultiple` manages its own
transaction and cannot run inside the advisory `BEGIN IMMEDIATE` lock the migrator holds — but it
means a migration file must satisfy:

- **One statement per `;`.** No `;` anywhere except as a statement terminator.
- **No `CREATE TRIGGER`** (or anything else with a `BEGIN…END` body) — the body's inner `;` would be
  split into fragments.
- **No standalone `BEGIN` / `COMMIT` / `END`** — the migrator owns the surrounding transaction; a
  migration must not manage its own.
- **No `;` inside a string literal** (e.g. `INSERT … VALUES ('a;b')`) and no unterminated literal.
- `PRAGMA` statements **are** allowed — Prisma's SQLite table-rebuild pattern emits
  `PRAGMA defer_foreign_keys/foreign_keys` pairs and they split and execute fine.

### Enforcement (§17 migration-safety guard)

`assertSplittableSql(name, sql)` in `db-migrator.ts` rejects any migration violating the rules above
with a `DbMigrationError` (`code: 'unsafe_migration'`) **naming the offending file**, _before_ any
DDL touches the database. It runs on every boot/`MIGRATE_ONLY` pass and is covered by the
`MIG-GUARD-*` unit tests, which also assert that **every real migration under
`apps/api/prisma/migrations/` passes the guard** — so an unsafe migration fails CI, not production.

If you genuinely need a trigger or a multi-statement procedural body, do it in application code or
extend the migrator first — do not weaken the guard.

## External identity database (PostgreSQL) schema

The optional external identity store manages its own schema separately
(`apps/api/src/identity/store/external/external-schema.ts`): versioned `runExternalMigrations`
ladder with an instance marker that distinguishes _ours_ vs _foreign_ schemas. Its safety nets
(atomic init, half-init recovery, ladder upgrade tests) live in the PGlite test suite under
`apps/api/test/unit/identity/store/`.
