import { sql } from 'kysely';
import {
	classifyOwnership,
	CURRENT_SCHEMA_VERSION,
	ensureSchema,
	runExternalMigrations,
} from '@api/identity/store/external/external-schema';
import { createPgliteKysely } from '@test/support/identity/pglite-store';

jest.setTimeout(60_000);

/**
 * §17 external-DB migration-ladder tests (PGlite). Structured per-version so a future v2 step only
 * adds an entry: seed v(N-1), run the migrations, assert the upgrade. Plus the legacy half-init
 * recovery case and the newer-schema downgrade guard.
 */
describe('external schema migration ladder (EXT-LADDER, §17)', () => {
	it('EXT-LADDER-01: a v0 (empty) database upgrades to the current version with all tables', async () => {
		const db = await createPgliteKysely();
		try {
			const version = await runExternalMigrations(db, 'postgres');
			expect(version).toBe(CURRENT_SCHEMA_VERSION);
			const meta = await sql<{
				value: string;
			}>`select value from nestidp_meta where key = 'schema_version'`.execute(db);
			expect(meta.rows[0]?.value).toBe(String(CURRENT_SCHEMA_VERSION));
			const tables = await sql<{
				table_name: string;
			}>`select table_name from information_schema.tables where table_name like 'nestidp_%'`.execute(
				db,
			);
			const names = tables.rows.map((r) => r.table_name).sort();
			expect(names).toEqual(
				expect.arrayContaining([
					'nestidp_meta',
					'nestidp_user',
					'nestidp_group',
					'nestidp_role',
					'nestidp_user_group',
					'nestidp_user_role',
				]),
			);
		} finally {
			await db.destroy();
		}
	});

	it('EXT-LADDER-02: re-running the migrations on a current-version database is a no-op', async () => {
		const db = await createPgliteKysely();
		try {
			await runExternalMigrations(db, 'postgres');
			await sql`insert into nestidp_user
				(id, external_id, api_connection_id, origin, username, password_hash, password_hash_algorithm, active, created_at, updated_at)
				values ('u1', 'ext-1', 'conn-1', 'MANUAL', 'alice', 'x', 'bcrypt', true, now(), now())`.execute(db);
			const version = await runExternalMigrations(db, 'postgres');
			expect(version).toBe(CURRENT_SCHEMA_VERSION);
			// Existing data untouched by the idempotent re-run.
			const rows = await sql<{ username: string }>`select username from nestidp_user`.execute(db);
			expect(rows.rows.map((r) => r.username)).toEqual(['alice']);
		} finally {
			await db.destroy();
		}
	});

	it('EXT-LADDER-03: a schema stamped by a NEWER build is refused, not silently modified', async () => {
		const db = await createPgliteKysely();
		try {
			await runExternalMigrations(db, 'postgres');
			await sql`update nestidp_meta set value = ${String(CURRENT_SCHEMA_VERSION + 1)} where key = 'schema_version'`.execute(
				db,
			);
			await expect(runExternalMigrations(db, 'postgres')).rejects.toThrow(
				/newer than this build supports/,
			);
		} finally {
			await db.destroy();
		}
	});

	it('EXT-LADDER-04: legacy half-init (tables + meta, marker never stamped) is recovered, not bricked as foreign', async () => {
		const db = await createPgliteKysely();
		try {
			// Simulate a pre-1.18.1 crash between schema creation and the marker write.
			await runExternalMigrations(db, 'postgres');
			await sql`delete from nestidp_meta where key = 'instance_id'`.execute(db);

			// §17: recoverable, not 'foreign'.
			await expect(classifyOwnership(db)).resolves.toBe('empty');

			const result = await ensureSchema(db, 'postgres', 'instance-test');
			expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
			const marker = await sql<{
				value: string;
			}>`select value from nestidp_meta where key = 'instance_id'`.execute(db);
			expect(marker.rows[0]?.value).toBe('instance-test');
			await expect(classifyOwnership(db)).resolves.toBe('ours');
		} finally {
			await db.destroy();
		}
	});

	it('EXT-LADDER-05: a database with foreign-looking prefixed tables but NO meta table stays foreign', async () => {
		const db = await createPgliteKysely();
		try {
			await sql`create table nestidp_user (id text primary key)`.execute(db);
			await expect(classifyOwnership(db)).resolves.toBe('foreign');
			await expect(ensureSchema(db, 'postgres', 'instance-test')).resolves.toMatchObject({
				ownership: 'foreign',
			});
		} finally {
			await db.destroy();
		}
	});
});
