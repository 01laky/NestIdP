import { readFileSync } from 'node:fs';
import { createClient, type Client } from '@libsql/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';

/**
 * Single source of truth for opening the libSQL (SQLite-compatible) database. The runtime talks to
 * the DB exclusively through the Prisma libSQL driver adapter so the on-disk file can be encrypted
 * at rest — Prisma's bundled SQLite engine cannot open an encrypted file.
 */

export function requireDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
	const url = (env.DATABASE_URL ?? '').trim();
	if (!url) {
		throw new Error('DATABASE_URL must not be empty');
	}
	if (!url.startsWith('file:')) {
		throw new Error('DATABASE_URL must use the file: scheme (libSQL local file)');
	}
	return url;
}

/**
 * Resolve the at-rest database encryption key. Accepts either `DATABASE_ENCRYPTION_KEY` (inline) or
 * `DATABASE_ENCRYPTION_KEY_FILE` (a mounted secret file) — not both. In production a key is required;
 * elsewhere an empty result means the file is opened unencrypted (test/dev convenience).
 * This key is independent of the app-layer `ENCRYPTION_KEY` used for column-level secrets.
 */
export function resolveDatabaseEncryptionKey(
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const inline = env.DATABASE_ENCRYPTION_KEY?.trim();
	const file = env.DATABASE_ENCRYPTION_KEY_FILE?.trim();
	if (inline && file) {
		throw new Error('Set only one of DATABASE_ENCRYPTION_KEY or DATABASE_ENCRYPTION_KEY_FILE');
	}
	let key = inline || undefined;
	if (!key && file) {
		key = readFileSync(file, 'utf8').replace(/\r?\n$/, '');
		if (!key) {
			throw new Error(`DATABASE_ENCRYPTION_KEY_FILE "${file}" is empty`);
		}
	}
	if (!key && env.NODE_ENV === 'production') {
		throw new Error(
			'DATABASE_ENCRYPTION_KEY (or DATABASE_ENCRYPTION_KEY_FILE) is required in production — refusing to run an unencrypted database',
		);
	}
	return key || undefined;
}

export function databaseEncryptionMode(
	env: NodeJS.ProcessEnv = process.env,
): 'encrypted' | 'plaintext' {
	return resolveDatabaseEncryptionKey(env) ? 'encrypted' : 'plaintext';
}

/** Build the Prisma libSQL driver adapter from the environment (used by PrismaService). */
export function buildLibsqlAdapter(env: NodeJS.ProcessEnv = process.env): PrismaLibSQL {
	return new PrismaLibSQL({
		url: requireDatabaseUrl(env),
		encryptionKey: resolveDatabaseEncryptionKey(env),
	});
}

/** Open a raw libSQL client (used by the migrator and the db:* maintenance scripts). */
export function createLibsqlClient(opts?: {
	url?: string;
	encryptionKey?: string | undefined;
}): Client {
	const url = opts?.url ?? requireDatabaseUrl();
	const encryptionKey =
		opts && 'encryptionKey' in opts ? opts.encryptionKey : resolveDatabaseEncryptionKey();
	return createClient({ url, encryptionKey });
}
