import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresDialect } from 'kysely';
import { ensureSchema } from '@api/identity/store/external/external-schema';
import type { ExternalIdentityDB } from '@api/identity/store/external/external-schema-types';
import { SqlIdentityStore } from '@api/identity/store/external/sql-identity-store';

export interface PgliteStoreHandle {
	db: Kysely<ExternalIdentityDB>;
	store: SqlIdentityStore;
	destroy: () => Promise<void>;
}

/**
 * In-process Postgres (PGlite) wired to Kysely's official PostgresDialect via a thin pool shim, so the
 * external SqlIdentityStore is exercised against a real Postgres dialect with no DB service in CI.
 */
export async function createPgliteKysely(): Promise<Kysely<ExternalIdentityDB>> {
	const pg = new PGlite();
	const client = {
		async query(sql: string, params: unknown[]) {
			const r = await pg.query(sql, params ?? []);
			return {
				rows: r.rows,
				rowCount: (r as { affectedRows?: number }).affectedRows ?? r.rows.length,
				command: '',
			};
		},
		release() {},
	};
	const pool = {
		async connect() {
			return client;
		},
		async end() {
			await pg.close();
		},
	};
	return new Kysely<ExternalIdentityDB>({ dialect: new PostgresDialect({ pool: pool as never }) });
}

export async function createPgliteStore(options?: {
	ensureSchema?: boolean;
}): Promise<PgliteStoreHandle> {
	const db = await createPgliteKysely();
	if (options?.ensureSchema !== false) {
		await ensureSchema(db, 'postgres', 'test-instance');
	}
	const store = new SqlIdentityStore(db, 'postgres');
	return { db, store, destroy: () => db.destroy() };
}
