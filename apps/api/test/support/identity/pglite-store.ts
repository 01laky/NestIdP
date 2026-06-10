import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { ensureSchema } from '@api/identity/store/external/external-schema';
import type { ExternalIdentityDB } from '@api/identity/store/external/external-schema-types';
import { SqlIdentityStore } from '@api/identity/store/external/sql-identity-store';

export interface PgliteStoreHandle {
	db: Kysely<ExternalIdentityDB>;
	store: SqlIdentityStore;
	destroy: () => Promise<void>;
}

export interface PgliteKyselyOptions {
	/** Called before every statement; throwing simulates a mid-operation query failure. */
	interceptQuery?: (sqlText: string, params: unknown[]) => void;
}

/**
 * In-process Postgres (PGlite) wired to Kysely's official PostgresDialect via a thin pool shim, so the
 * external SqlIdentityStore is exercised against a real Postgres dialect with no DB service in CI.
 */
export async function createPgliteKysely(
	options?: PgliteKyselyOptions,
): Promise<Kysely<ExternalIdentityDB>> {
	const pg = new PGlite();
	const client = {
		async query(sqlText: string, params: unknown[]) {
			options?.interceptQuery?.(sqlText, params ?? []);
			const r = await pg.query(sqlText, params ?? []);
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
	/** Mirrors the production pgSchema option: session search_path + schema-aware bootstrap. */
	pgSchema?: string;
	interceptQuery?: PgliteKyselyOptions['interceptQuery'];
}): Promise<PgliteStoreHandle> {
	const db = await createPgliteKysely({ interceptQuery: options?.interceptQuery });
	if (options?.pgSchema) {
		// The shim has a single session; production sets this per-connection via pg Pool `options`.
		await sql`set search_path to ${sql.id(options.pgSchema)}, public`.execute(db);
	}
	if (options?.ensureSchema !== false) {
		await ensureSchema(db, 'postgres', 'test-instance', options?.pgSchema ?? null);
	}
	const store = new SqlIdentityStore(db, 'postgres');
	return { db, store, destroy: () => db.destroy() };
}
