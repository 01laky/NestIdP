import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import {
	appliedMigrationCount,
	applyMigrations,
	assertSplittableSql,
	DbMigrationError,
	runMigrations,
	splitSqlStatements,
} from '@api/prisma/db-migrator';

function makeMigrationsDir(steps: Array<{ name: string; sql: string }>): string {
	const dir = mkdtempSync(join(tmpdir(), 'nestidp-mig-'));
	for (const s of steps) {
		mkdirSync(join(dir, s.name));
		writeFileSync(join(dir, s.name, 'migration.sql'), s.sql);
	}
	return dir;
}
function tmpDbUrl(): { url: string; path: string } {
	const path = join(mkdtempSync(join(tmpdir(), 'nestidp-migdb-')), `${randomUUID()}.db`);
	return { url: `file:${path}`, path };
}

jest.setTimeout(30_000);

const STEPS = [
	{ name: '20260101000000_a', sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY);' },
	{
		name: '20260102000000_b',
		sql: 'CREATE TABLE b (id INTEGER PRIMARY KEY);\nALTER TABLE a ADD COLUMN note TEXT;',
	},
];

describe('db-migrator', () => {
	it('MIG-01: fresh DB applies all migrations and tracks each once', async () => {
		const dir = makeMigrationsDir(STEPS);
		const { url } = tmpDbUrl();
		const client = createClient({ url });
		try {
			const res = await applyMigrations(client, { migrationsDir: dir });
			expect(res.applied).toEqual(STEPS.map((s) => s.name));
			const tracked = await client.execute('SELECT name FROM __app_migrations ORDER BY name');
			expect(tracked.rows.map((r) => String(r.name))).toEqual(STEPS.map((s) => s.name));
			const tables = await client.execute(
				"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('a','b')",
			);
			expect(tables.rows.length).toBe(2);
		} finally {
			client.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('MIG-02: second run is idempotent (applies nothing)', async () => {
		const dir = makeMigrationsDir(STEPS);
		const { url } = tmpDbUrl();
		const client = createClient({ url });
		try {
			await applyMigrations(client, { migrationsDir: dir });
			const res = await applyMigrations(client, { migrationsDir: dir });
			expect(res.applied).toEqual([]);
			expect(res.alreadyApplied).toBe(STEPS.length);
		} finally {
			client.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('MIG-03: only pending migrations run, in order', async () => {
		const dir = makeMigrationsDir(STEPS);
		const { url } = tmpDbUrl();
		const client = createClient({ url });
		try {
			await applyMigrations(client, { migrationsDir: makeMigrationsDir([STEPS[0]]) }); // apply only A first
			// Re-point at the full dir; only B should run.
			const res = await applyMigrations(client, { migrationsDir: dir });
			expect(res.applied).toEqual([STEPS[1].name]);
		} finally {
			client.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('MIG-04: a failing migration aborts the batch atomically (nothing recorded)', async () => {
		const dir = makeMigrationsDir([
			{ name: '20260101000000_ok', sql: 'CREATE TABLE ok (id INTEGER PRIMARY KEY);' },
			{ name: '20260102000000_bad', sql: 'CREATE TABLE ok (id INTEGER PRIMARY KEY);' }, // duplicate table → error
		]);
		const { url } = tmpDbUrl();
		const client = createClient({ url });
		try {
			await expect(applyMigrations(client, { migrationsDir: dir })).rejects.toBeInstanceOf(
				DbMigrationError,
			);
			// The whole pending batch is rolled back — neither migration is recorded, no 'ok' table.
			const tracked = await client.execute('SELECT name FROM __app_migrations');
			expect(tracked.rows.map((r) => String(r.name))).toEqual([]);
			const okTable = await client.execute(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='ok'",
			);
			expect(okTable.rows.length).toBe(0);
		} finally {
			client.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('MIG-05: drift (changed applied migration.sql) is rejected', async () => {
		const dir = makeMigrationsDir(STEPS);
		const { url } = tmpDbUrl();
		const client = createClient({ url });
		try {
			await applyMigrations(client, { migrationsDir: dir });
			// Mutate an already-applied migration file → checksum drift.
			writeFileSync(join(dir, STEPS[0].name, 'migration.sql'), `${STEPS[0].sql}\n-- changed`);
			await expect(applyMigrations(client, { migrationsDir: dir })).rejects.toThrow(/drift/i);
		} finally {
			client.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('MIG-06: runMigrations works against an ENCRYPTED DB', async () => {
		const dir = makeMigrationsDir(STEPS);
		const { url, path } = tmpDbUrl();
		try {
			const res = await runMigrations({ url, encryptionKey: 'mig-key', migrationsDir: dir });
			expect(res.applied.length).toBe(STEPS.length);
			// The file is encrypted: a keyless open cannot read the tracking table.
			const keyless = createClient({ url });
			await expect(keyless.execute('SELECT COUNT(*) FROM __app_migrations')).rejects.toBeDefined();
			keyless.close();
		} finally {
			for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) rmSync(f);
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('OPS-04: a missing file (non-prod) is created fresh and fully migrated', async () => {
		const dir = makeMigrationsDir(STEPS);
		const { url, path } = tmpDbUrl();
		try {
			expect(existsSync(path)).toBe(false);
			const res = await runMigrations({ url, encryptionKey: undefined, migrationsDir: dir });
			expect(res.applied).toEqual(STEPS.map((s) => s.name));
			expect(existsSync(path)).toBe(true);
		} finally {
			for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) rmSync(f);
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('OPS-04: a garbage/corrupt file fails with a wrong-key-or-corrupt error', async () => {
		const dir = makeMigrationsDir(STEPS);
		const { url, path } = tmpDbUrl();
		writeFileSync(path, 'this is definitely not a sqlite database file');
		try {
			await expect(
				runMigrations({ url, encryptionKey: undefined, migrationsDir: dir }),
			).rejects.toMatchObject({
				code: 'wrong_key_or_corrupt',
			});
		} finally {
			for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) rmSync(f);
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('OPS-04: opening an encrypted DB with the WRONG key fails with a wrong-key-or-corrupt error', async () => {
		const dir = makeMigrationsDir(STEPS);
		const { url, path } = tmpDbUrl();
		try {
			await runMigrations({ url, encryptionKey: 'right-key', migrationsDir: dir });
			await expect(
				runMigrations({ url, encryptionKey: 'wrong-key', migrationsDir: dir }),
			).rejects.toMatchObject({
				code: 'wrong_key_or_corrupt',
			});
		} finally {
			for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) rmSync(f);
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('OPS-09: BEGIN IMMEDIATE is exclusive — a second writer cannot acquire the lock concurrently', async () => {
		const { url, path } = tmpDbUrl();
		const holder = createClient({ url });
		const contender = createClient({ url });
		try {
			await holder.execute('BEGIN IMMEDIATE');
			// While the holder owns the write lock, a second BEGIN IMMEDIATE is refused immediately.
			await expect(contender.execute('BEGIN IMMEDIATE')).rejects.toBeDefined();
			await holder.execute('ROLLBACK');
			// Once released, the contender can take the lock.
			await contender.execute('BEGIN IMMEDIATE');
			await contender.execute('ROLLBACK');
		} finally {
			holder.close();
			contender.close();
			for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) rmSync(f);
		}
	});

	it('OPS-09: a second migrator run after the first no-ops (each migration recorded exactly once)', async () => {
		const dir = makeMigrationsDir(STEPS);
		const { url, path } = tmpDbUrl();
		try {
			// Simulates the instance that waited for the lock: by the time it runs, all are applied.
			const first = await runMigrations({ url, encryptionKey: 'lock-key', migrationsDir: dir });
			const second = await runMigrations({ url, encryptionKey: 'lock-key', migrationsDir: dir });
			expect(first.applied.length).toBe(STEPS.length);
			expect(second.applied).toEqual([]);
			const client = createClient({ url, encryptionKey: 'lock-key' });
			const tracked = await client.execute('SELECT name FROM __app_migrations ORDER BY name');
			expect(tracked.rows.map((r) => String(r.name))).toEqual(STEPS.map((s) => s.name));
			client.close();
		} finally {
			for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) rmSync(f);
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('MIG-07: an empty migrations dir applies nothing and creates the tracking table', async () => {
		const dir = makeMigrationsDir([]);
		const { url } = tmpDbUrl();
		const client = createClient({ url });
		try {
			const res = await applyMigrations(client, { migrationsDir: dir });
			expect(res).toEqual({ applied: [], alreadyApplied: 0, total: 0 });
			const t = await client.execute(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='__app_migrations'",
			);
			expect(t.rows.length).toBe(1);
		} finally {
			client.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('MIG-08: a non-existent migrations dir is treated as zero migrations', async () => {
		const { url } = tmpDbUrl();
		const client = createClient({ url });
		try {
			const res = await applyMigrations(client, {
				migrationsDir: join(tmpdir(), `nope-${randomUUID()}`),
			});
			expect(res.applied).toEqual([]);
			expect(res.total).toBe(0);
		} finally {
			client.close();
		}
	});

	it('MIG-09: stray non-directory files in the migrations dir are ignored', async () => {
		const dir = makeMigrationsDir(STEPS);
		writeFileSync(join(dir, 'README.md'), '# not a migration');
		writeFileSync(join(dir, '.DS_Store'), 'junk');
		const { url } = tmpDbUrl();
		const client = createClient({ url });
		try {
			const res = await applyMigrations(client, { migrationsDir: dir });
			expect(res.applied).toEqual(STEPS.map((s) => s.name));
		} finally {
			client.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('MIG-10: migrations apply in lexicographic order regardless of creation order', async () => {
		// Intentionally create out of order; expect sorted application.
		const out = [
			{ name: '20260103000000_c', sql: 'CREATE TABLE c (id INTEGER PRIMARY KEY);' },
			{ name: '20260101000000_a', sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY);' },
			{ name: '20260102000000_b', sql: 'CREATE TABLE b (id INTEGER PRIMARY KEY);' },
		];
		const dir = makeMigrationsDir(out);
		const { url } = tmpDbUrl();
		const client = createClient({ url });
		try {
			const res = await applyMigrations(client, { migrationsDir: dir });
			expect(res.applied).toEqual(['20260101000000_a', '20260102000000_b', '20260103000000_c']);
		} finally {
			client.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('MIG-11: appliedMigrationCount reflects applied rows; returns 0 before the table exists', async () => {
		const dir = makeMigrationsDir(STEPS);
		const { url } = tmpDbUrl();
		const client = createClient({ url });
		try {
			// No tracking table yet → 0 (the helper swallows the "no such table" error).
			await expect(appliedMigrationCount(client)).resolves.toBe(0);
			await applyMigrations(client, { migrationsDir: dir });
			await expect(appliedMigrationCount(client)).resolves.toBe(STEPS.length);
		} finally {
			client.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('MIG-12: a migration with a multi-statement, commented, no-trailing-semicolon body applies fully', async () => {
		const dir = makeMigrationsDir([
			{
				name: '20260101000000_complex',
				sql: [
					'-- create the first table',
					'CREATE TABLE p (id INTEGER PRIMARY KEY, name TEXT);',
					'',
					'-- and a second one, plus an index',
					'CREATE TABLE q (id INTEGER PRIMARY KEY, p_id INTEGER);',
					'CREATE INDEX q_p_id ON q (p_id)', // no trailing semicolon on the final statement
				].join('\n'),
			},
		]);
		const { url } = tmpDbUrl();
		const client = createClient({ url });
		try {
			const res = await applyMigrations(client, { migrationsDir: dir });
			expect(res.applied).toEqual(['20260101000000_complex']);
			const tables = await client.execute(
				"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('p','q')",
			);
			expect(tables.rows.length).toBe(2);
			const idx = await client.execute(
				"SELECT name FROM sqlite_master WHERE type='index' AND name='q_p_id'",
			);
			expect(idx.rows.length).toBe(1);
		} finally {
			client.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('migration-safety guard (MIG-GUARD, §17)', () => {
	const expectUnsafe = (name: string, sql: string, match: RegExp) => {
		expect(() => assertSplittableSql(name, sql)).toThrow(DbMigrationError);
		try {
			assertSplittableSql(name, sql);
		} catch (e) {
			expect((e as DbMigrationError).code).toBe('unsafe_migration');
			expect((e as DbMigrationError).message).toMatch(match);
			expect((e as DbMigrationError).message).toContain(name);
		}
	};

	it('MIG-GUARD-01: CREATE TRIGGER is rejected (its BEGIN…END body would be split apart)', () => {
		expectUnsafe(
			'20990101000000_trigger',
			'CREATE TRIGGER t AFTER INSERT ON a FOR EACH ROW SELECT 1;',
			/CREATE TRIGGER/,
		);
		expectUnsafe('20990101000000_trig2', 'create temporary trigger t2 ...', /CREATE TRIGGER/);
	});

	it('MIG-GUARD-02: standalone BEGIN / END are rejected (the migrator owns the transaction)', () => {
		expectUnsafe('20990101000000_begin', 'BEGIN;\nCREATE TABLE a (id INT);\nCOMMIT;', /BEGIN/);
		expectUnsafe('20990101000000_end', 'CREATE TABLE a (id INT);\nEND', /END/);
	});

	it('MIG-GUARD-03: a ";" inside a string literal is rejected with the file named', () => {
		expectUnsafe(
			'20990101000000_semicolon',
			"INSERT INTO t (v) VALUES ('a;b');",
			/';' inside a string literal/,
		);
	});

	it('MIG-GUARD-04: PRAGMA is allowed (Prisma SQLite table-rebuilds emit it; splitter-safe)', () => {
		expect(() =>
			assertSplittableSql(
				'20990101000000_pragma',
				'PRAGMA defer_foreign_keys=ON;\nCREATE TABLE a (id INT);\nPRAGMA defer_foreign_keys=OFF;',
			),
		).not.toThrow();
	});

	it('MIG-GUARD-05: an unterminated string literal is rejected', () => {
		expectUnsafe('20990101000000_unterminated', "INSERT INTO t (v) VALUES ('abc", /unterminated/);
	});

	it('MIG-GUARD-06: keywords inside string literals or comments do NOT trip the guard', () => {
		expect(() =>
			assertSplittableSql(
				'20990101000000_ok',
				[
					'-- this CREATE TRIGGER mention is a comment; BEGIN END',
					"INSERT INTO t (v) VALUES ('CREATE TRIGGER BEGIN END');",
					"INSERT INTO t (v) VALUES ('it''s quoted');",
					'CREATE TABLE ending (id INT);', // identifier containing "end" must not match END
				].join('\n'),
			),
		).not.toThrow();
	});

	it('MIG-GUARD-07: a migration dir containing an unsafe file fails before touching the DB', async () => {
		const dir = makeMigrationsDir([
			{ name: '20260101000000_ok', sql: 'CREATE TABLE ok (id INTEGER PRIMARY KEY);' },
			{
				name: '20260102000000_bad_trigger',
				sql: 'CREATE TRIGGER tr AFTER INSERT ON ok FOR EACH ROW SELECT 1;',
			},
		]);
		const { url } = tmpDbUrl();
		const client = createClient({ url });
		try {
			await expect(applyMigrations(client, { migrationsDir: dir })).rejects.toMatchObject({
				code: 'unsafe_migration',
			});
			// Listing happens before any DDL — nothing applied, not even the safe first migration.
			const tables = await client.execute(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='ok'",
			);
			expect(tables.rows.length).toBe(0);
		} finally {
			client.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('MIG-GUARD-08: every real migration in prisma/migrations passes the guard', () => {
		const real = join(__dirname, '../../../prisma/migrations');
		expect(existsSync(real)).toBe(true);
		const { readdirSync, readFileSync, statSync } =
			jest.requireActual<typeof import('node:fs')>('node:fs');
		const names = readdirSync(real).filter((n) => statSync(join(real, n)).isDirectory());
		expect(names.length).toBeGreaterThan(0);
		for (const name of names) {
			const sql = readFileSync(join(real, name, 'migration.sql'), 'utf8');
			expect(() => assertSplittableSql(name, sql)).not.toThrow();
		}
	});
});

describe('splitSqlStatements (SQL-SPLIT)', () => {
	it('SQL-SPLIT-01: splits on semicolons and trims each statement', () => {
		expect(splitSqlStatements('CREATE TABLE a (id INT); CREATE TABLE b (id INT);')).toEqual([
			'CREATE TABLE a (id INT)',
			'CREATE TABLE b (id INT)',
		]);
	});

	it('SQL-SPLIT-02: strips whole-line -- comments', () => {
		const sql = [
			'-- a comment',
			'CREATE TABLE a (id INT);',
			'-- another',
			'CREATE TABLE b (id INT);',
		].join('\n');
		expect(splitSqlStatements(sql)).toEqual(['CREATE TABLE a (id INT)', 'CREATE TABLE b (id INT)']);
	});

	it('SQL-SPLIT-03: drops blank statements (trailing semicolons, blank lines)', () => {
		expect(splitSqlStatements('CREATE TABLE a (id INT);\n\n;\n   ;\n')).toEqual([
			'CREATE TABLE a (id INT)',
		]);
	});

	it('SQL-SPLIT-04: a statement without a trailing semicolon is still returned', () => {
		expect(splitSqlStatements('CREATE TABLE a (id INT)')).toEqual(['CREATE TABLE a (id INT)']);
	});

	it('SQL-SPLIT-05: empty / whitespace-only / comment-only input yields no statements', () => {
		expect(splitSqlStatements('')).toEqual([]);
		expect(splitSqlStatements('   \n\t\n')).toEqual([]);
		expect(splitSqlStatements('-- only a comment\n-- and another')).toEqual([]);
	});

	it('SQL-SPLIT-06: indented comment lines are also stripped', () => {
		expect(splitSqlStatements('\t-- indented comment\nCREATE TABLE a (id INT);')).toEqual([
			'CREATE TABLE a (id INT)',
		]);
	});
});
