import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Client } from '@libsql/client';
import { createLibsqlClient } from './libsql';

const MIGRATIONS_TABLE = '__app_migrations';

export class DbMigrationError extends Error {
	constructor(
		message: string,
		public readonly code:
			| 'wrong_key_or_corrupt'
			| 'integrity_failed'
			| 'drift'
			| 'apply_failed'
			| 'unsafe_migration',
	) {
		super(message);
		this.name = 'DbMigrationError';
	}
}

export interface MigrateResult {
	applied: string[];
	alreadyApplied: number;
	total: number;
}

function defaultMigrationsDir(): string {
	return process.env.MIGRATIONS_DIR
		? resolve(process.env.MIGRATIONS_DIR)
		: resolve(process.cwd(), 'prisma/migrations');
}

/**
 * Split a migration.sql into individual statements. Our migrations are plain additive SQLite DDL
 * (no triggers, no BEGIN/END blocks, no string literals containing ';'), so a comment-stripped
 * split on ';' is safe — and necessary because libSQL's executeMultiple manages its own transaction
 * and cannot run inside the BEGIN IMMEDIATE lock we hold while applying. assertSplittableSql (§17)
 * enforces these assumptions before anything is applied.
 */
export function splitSqlStatements(sql: string): string[] {
	return sql
		.split('\n')
		.filter((line) => !line.trim().startsWith('--'))
		.join('\n')
		.split(';')
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/**
 * §17 migration-safety guard: reject any migration the naive `;`-splitter above cannot handle, so
 * the foot-gun fails loudly at boot/test time instead of silently corrupting a statement at
 * runtime. Enforced constraints (also documented in docs/migrations.md):
 *  - no `CREATE TRIGGER` (its `BEGIN…END` body contains `;` the splitter would cut),
 *  - no standalone `BEGIN`/`END` (the migrator owns the surrounding transaction),
 *  - no `;` inside a string literal, and no unterminated string literal.
 * `PRAGMA` is allowed: Prisma's SQLite table-rebuild pattern emits defer_foreign_keys/foreign_keys
 * pragmas and they split/execute fine as single statements.
 */
export function assertSplittableSql(name: string, sql: string): void {
	const stripped = sql
		.split('\n')
		.filter((line) => !line.trim().startsWith('--'))
		.join('\n');

	// Walk the SQL once: detect `;` inside '…' literals and build a copy with literal contents
	// blanked out so keyword checks cannot be fooled by strings like 'CREATE TRIGGER'.
	let inString = false;
	let blanked = '';
	for (let i = 0; i < stripped.length; i += 1) {
		const ch = stripped[i];
		if (ch === "'") {
			if (inString && stripped[i + 1] === "'") {
				i += 1; // escaped '' inside a literal
				blanked += '  ';
				continue;
			}
			inString = !inString;
			blanked += ch;
			continue;
		}
		if (inString) {
			if (ch === ';') {
				throw new DbMigrationError(
					`Migration "${name}" contains a ';' inside a string literal — the migrator splits statements on ';' and would corrupt it. Rewrite the statement (one statement per ';', no ';' in literals).`,
					'unsafe_migration',
				);
			}
			blanked += ch === '\n' ? '\n' : ' ';
			continue;
		}
		blanked += ch;
	}
	if (inString) {
		throw new DbMigrationError(
			`Migration "${name}" contains an unterminated string literal.`,
			'unsafe_migration',
		);
	}

	const offenders: Array<{ pattern: RegExp; label: string }> = [
		{ pattern: /\bCREATE\s+(TEMP(ORARY)?\s+)?TRIGGER\b/i, label: 'CREATE TRIGGER' },
		{ pattern: /(^|[^\w])BEGIN($|[^\w])/i, label: 'BEGIN' },
		{ pattern: /(^|[^\w])END($|[^\w])/i, label: 'END' },
	];
	for (const { pattern, label } of offenders) {
		if (pattern.test(blanked)) {
			throw new DbMigrationError(
				`Migration "${name}" contains "${label}", which the simple ';'-splitting migrator cannot apply safely (see docs/migrations.md). Use plain additive DDL — one statement per ';'.`,
				'unsafe_migration',
			);
		}
	}
}

function listMigrations(dir: string): Array<{ name: string; sql: string; checksum: string }> {
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir)
		.filter((n) => statSync(join(dir, n)).isDirectory())
		.sort()
		.map((name) => {
			const sql = readFileSync(join(dir, name, 'migration.sql'), 'utf8');
			assertSplittableSql(name, sql); // §17: fail loud on splitter-unsafe SQL before touching the DB
			return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
		});
}

function isLockedError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /database is locked|SQLITE_BUSY/i.test(message);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Acquire the exclusive write lock, waiting out a concurrent migrator (BEGIN IMMEDIATE + backoff). */
async function acquireWriteLock(client: Client, attempts = 100, delayMs = 100): Promise<void> {
	for (let i = 0; i < attempts; i += 1) {
		try {
			await client.execute('BEGIN IMMEDIATE');
			return;
		} catch (error) {
			if (!isLockedError(error) || i === attempts - 1) {
				throw error;
			}
			await sleep(delayMs);
		}
	}
}

/** Apply pending migrations through an already-open libSQL client. Caller owns the client lifecycle. */
export async function applyMigrations(
	client: Client,
	opts?: { migrationsDir?: string },
): Promise<MigrateResult> {
	const dir = opts?.migrationsDir ?? defaultMigrationsDir();
	const migrations = listMigrations(dir);

	await client.execute(
		`CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`,
	);

	const appliedRows = await client.execute(`SELECT name, checksum FROM "${MIGRATIONS_TABLE}"`);
	const applied = new Map<string, string>();
	for (const row of appliedRows.rows) {
		applied.set(String(row.name), String(row.checksum));
	}

	// Drift detection: a previously-applied migration whose file changed.
	for (const m of migrations) {
		const prev = applied.get(m.name);
		if (prev !== undefined && prev !== m.checksum) {
			throw new DbMigrationError(
				`Migration "${m.name}" was already applied but its migration.sql changed (checksum drift)`,
				'drift',
			);
		}
	}

	const pending = migrations.filter((m) => !applied.has(m.name));
	if (pending.length === 0) {
		return { applied: [], alreadyApplied: applied.size, total: migrations.length };
	}

	// Exclusive write lock so two booting instances cannot apply DDL concurrently. The libSQL busy
	// timeout does not always cover BEGIN IMMEDIATE, so retry on a "database is locked" error with a
	// short backoff — this is the advisory lock that serializes concurrent migrators.
	await acquireWriteLock(client);
	try {
		// Re-read inside the lock (another instance may have applied while we waited).
		const fresh = await client.execute(`SELECT name FROM "${MIGRATIONS_TABLE}"`);
		const freshApplied = new Set(fresh.rows.map((r) => String(r.name)));
		const appliedNow: string[] = [];
		for (const m of pending) {
			if (freshApplied.has(m.name)) {
				continue;
			}
			for (const statement of splitSqlStatements(m.sql)) {
				await client.execute(statement);
			}
			await client.execute({
				sql: `INSERT INTO "${MIGRATIONS_TABLE}" (name, checksum, applied_at) VALUES (?, ?, ?)`,
				args: [m.name, m.checksum, new Date().toISOString()],
			});
			appliedNow.push(m.name);
		}
		await client.execute('COMMIT');
		return { applied: appliedNow, alreadyApplied: applied.size, total: migrations.length };
	} catch (error) {
		try {
			await client.execute('ROLLBACK');
		} catch {
			// ignore
		}
		if (error instanceof DbMigrationError) {
			throw error;
		}
		throw new DbMigrationError(
			`Failed to apply migrations: ${error instanceof Error ? error.message : String(error)}`,
			'apply_failed',
		);
	}
}

export async function setConnectionPragmas(client: Client): Promise<void> {
	await client.execute('PRAGMA journal_mode = WAL');
	await client.execute('PRAGMA foreign_keys = ON');
	await client.execute('PRAGMA busy_timeout = 5000');
	await client.execute('PRAGMA synchronous = NORMAL');
}

export async function integrityCheck(client: Client): Promise<void> {
	let result;
	try {
		result = await client.execute('PRAGMA integrity_check');
	} catch (error) {
		// Opening/decrypting failed — wrong key or a corrupt/non-DB file.
		throw new DbMigrationError(
			`Database could not be opened (wrong DATABASE_ENCRYPTION_KEY or corrupt file): ${error instanceof Error ? error.message : String(error)}`,
			'wrong_key_or_corrupt',
		);
	}
	const status = result.rows.length ? String(Object.values(result.rows[0])[0]) : 'unknown';
	if (status.toLowerCase() !== 'ok') {
		throw new DbMigrationError(`Database integrity check failed: ${status}`, 'integrity_failed');
	}
}

/** High-level boot entry point: open keyed client, verify, set pragmas, apply migrations, close. */
export async function runMigrations(opts?: {
	url?: string;
	encryptionKey?: string | undefined;
	migrationsDir?: string;
}): Promise<MigrateResult> {
	const client = createLibsqlClient(
		opts ? { url: opts.url, encryptionKey: opts.encryptionKey } : undefined,
	);
	try {
		await integrityCheck(client);
		await setConnectionPragmas(client);
		return await applyMigrations(client, { migrationsDir: opts?.migrationsDir });
	} finally {
		client.close();
	}
}

/** Count of applied migrations (used by the health endpoint). */
export async function appliedMigrationCount(client: Client): Promise<number> {
	try {
		const r = await client.execute(`SELECT COUNT(*) AS n FROM "${MIGRATIONS_TABLE}"`);
		return Number(r.rows[0]?.n ?? 0);
	} catch {
		return 0;
	}
}
