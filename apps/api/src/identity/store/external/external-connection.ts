import { Kysely, MysqlDialect, PostgresDialect } from 'kysely';
import type { ExternalIdentityDB } from './external-schema-types';

export type ExternalDialect = 'postgres' | 'mysql';
export type ExternalSslMode = 'disable' | 'require' | 'verify-ca' | 'verify-full';

export interface ExternalDbConfig {
	dialect: ExternalDialect;
	host: string;
	port: number;
	database: string;
	username: string;
	password: string;
	sslMode: ExternalSslMode;
	sslCaCertPem?: string | null;
	pgSchema?: string | null;
	poolMax: number;
	connectTimeoutMs: number;
	queryTimeoutMs: number;
}

export interface ExternalKysely {
	db: Kysely<ExternalIdentityDB>;
	destroy(): Promise<void>;
}

/** A factory for the external Kysely instance — overridable in tests (PGlite). */
export interface ExternalKyselyFactory {
	create(config: ExternalDbConfig): ExternalKysely;
}

function pgSslOption(config: ExternalDbConfig): false | { rejectUnauthorized: boolean; ca?: string } {
	switch (config.sslMode) {
		case 'disable':
			return false;
		case 'require':
			return { rejectUnauthorized: false };
		case 'verify-ca':
		case 'verify-full':
			return { rejectUnauthorized: true, ...(config.sslCaCertPem ? { ca: config.sslCaCertPem } : {}) };
	}
}

function mysqlSslOption(config: ExternalDbConfig): undefined | { rejectUnauthorized: boolean; ca?: string } {
	switch (config.sslMode) {
		case 'disable':
			return undefined;
		case 'require':
			return { rejectUnauthorized: false };
		case 'verify-ca':
		case 'verify-full':
			return { rejectUnauthorized: true, ...(config.sslCaCertPem ? { ca: config.sslCaCertPem } : {}) };
	}
}

/** Production factory: real pg / mysql2 pools with TLS, pool sizing and per-statement timeouts. */
export class RealExternalKyselyFactory implements ExternalKyselyFactory {
	create(config: ExternalDbConfig): ExternalKysely {
		if (config.dialect === 'postgres') {
			// Lazy require so the driver is only loaded when an external DB is actually attached.

			const { Pool } = require('pg') as typeof import('pg');
			const pool = new Pool({
				host: config.host,
				port: config.port,
				database: config.database,
				user: config.username,
				password: config.password,
				max: config.poolMax,
				connectionTimeoutMillis: config.connectTimeoutMs,
				statement_timeout: config.queryTimeoutMs,
				query_timeout: config.queryTimeoutMs,
				ssl: pgSslOption(config),
			});
			const db = new Kysely<ExternalIdentityDB>({ dialect: new PostgresDialect({ pool }) });
			return { db, destroy: () => db.destroy() };
		}

		const mysql = require('mysql2') as typeof import('mysql2');
		const pool = mysql.createPool({
			host: config.host,
			port: config.port,
			database: config.database,
			user: config.username,
			password: config.password,
			connectionLimit: config.poolMax,
			connectTimeout: config.connectTimeoutMs,
			ssl: mysqlSslOption(config),
		});
		const db = new Kysely<ExternalIdentityDB>({ dialect: new MysqlDialect({ pool: pool as never }) });
		return { db, destroy: () => db.destroy() };
	}
}

export const EXTERNAL_KYSELY_FACTORY = Symbol('EXTERNAL_KYSELY_FACTORY');
