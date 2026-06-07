import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	buildLibsqlAdapter,
	createLibsqlClient,
	databaseEncryptionMode,
	requireDatabaseUrl,
	resolveDatabaseEncryptionKey,
} from '@api/prisma/libsql';

function tmpFile(name: string): { dir: string; path: string } {
	const dir = mkdtempSync(join(tmpdir(), 'nestidp-libsql-'));
	return { dir, path: join(dir, name) };
}

// ──────────────────────────────────────────────────────────────────────────────
// requireDatabaseUrl
// ──────────────────────────────────────────────────────────────────────────────
describe('requireDatabaseUrl (LIBSQL-URL)', () => {
	it('LIBSQL-URL-01: returns a trimmed file: URL', () => {
		expect(requireDatabaseUrl({ DATABASE_URL: 'file:./data/nestidp.db' } as never)).toBe(
			'file:./data/nestidp.db',
		);
		expect(requireDatabaseUrl({ DATABASE_URL: '  file:/abs/x.db  ' } as never)).toBe(
			'file:/abs/x.db',
		);
	});

	it('LIBSQL-URL-02: rejects an undefined / empty / whitespace URL', () => {
		expect(() => requireDatabaseUrl({} as never)).toThrow(/must not be empty/i);
		expect(() => requireDatabaseUrl({ DATABASE_URL: '' } as never)).toThrow(/must not be empty/i);
		expect(() => requireDatabaseUrl({ DATABASE_URL: '   ' } as never)).toThrow(
			/must not be empty/i,
		);
		expect(() => requireDatabaseUrl({ DATABASE_URL: '\t\n' } as never)).toThrow(
			/must not be empty/i,
		);
	});

	it('LIBSQL-URL-03: rejects every non-file scheme', () => {
		for (const url of [
			'postgresql://localhost:5432/db',
			'postgres://localhost/db',
			'mysql://localhost/db',
			'libsql://remote.turso.io',
			'http://localhost/db',
			'https://localhost/db',
			'sqlite:./x.db',
			'./relative.db',
			'/absolute.db',
		]) {
			expect(() => requireDatabaseUrl({ DATABASE_URL: url } as never)).toThrow(/file: scheme/i);
		}
	});

	it('LIBSQL-URL-04: scheme match is case-sensitive (FILE: is rejected)', () => {
		expect(() => requireDatabaseUrl({ DATABASE_URL: 'FILE:./x.db' } as never)).toThrow(
			/file: scheme/i,
		);
	});

	it('LIBSQL-URL-05: accepts a bare "file:" and in-memory style URLs', () => {
		expect(requireDatabaseUrl({ DATABASE_URL: 'file:' } as never)).toBe('file:');
		expect(requireDatabaseUrl({ DATABASE_URL: 'file::memory:' } as never)).toBe('file::memory:');
	});
});

// ──────────────────────────────────────────────────────────────────────────────
// resolveDatabaseEncryptionKey
// ──────────────────────────────────────────────────────────────────────────────
describe('resolveDatabaseEncryptionKey (LIBSQL-KEY)', () => {
	it('LIBSQL-KEY-01: inline key is trimmed', () => {
		expect(resolveDatabaseEncryptionKey({ DATABASE_ENCRYPTION_KEY: '  secret  ' } as never)).toBe(
			'secret',
		);
	});

	it('LIBSQL-KEY-02: a whitespace-only inline key is treated as absent (non-prod → undefined)', () => {
		expect(
			resolveDatabaseEncryptionKey({ DATABASE_ENCRYPTION_KEY: '   ' } as never),
		).toBeUndefined();
	});

	it('LIBSQL-KEY-03: a whitespace-only inline key in production is a hard error', () => {
		expect(() =>
			resolveDatabaseEncryptionKey({
				NODE_ENV: 'production',
				DATABASE_ENCRYPTION_KEY: '   ',
			} as never),
		).toThrow(/required in production/i);
	});

	it('LIBSQL-KEY-04: key file is read; only a trailing newline (LF/CRLF) is trimmed', () => {
		const { dir, path } = tmpFile('k');
		try {
			writeFileSync(path, 'lf-key\n');
			expect(resolveDatabaseEncryptionKey({ DATABASE_ENCRYPTION_KEY_FILE: path } as never)).toBe(
				'lf-key',
			);
			writeFileSync(path, 'crlf-key\r\n');
			expect(resolveDatabaseEncryptionKey({ DATABASE_ENCRYPTION_KEY_FILE: path } as never)).toBe(
				'crlf-key',
			);
			// Interior/leading whitespace is preserved (the key is taken verbatim apart from one trailing EOL).
			writeFileSync(path, '  spaced-key  \n');
			expect(resolveDatabaseEncryptionKey({ DATABASE_ENCRYPTION_KEY_FILE: path } as never)).toBe(
				'  spaced-key  ',
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('LIBSQL-KEY-05: a key file containing only a newline is rejected as empty', () => {
		const { dir, path } = tmpFile('empty');
		try {
			writeFileSync(path, '\n');
			expect(() =>
				resolveDatabaseEncryptionKey({ DATABASE_ENCRYPTION_KEY_FILE: path } as never),
			).toThrow(/empty/i);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('LIBSQL-KEY-06: a non-existent key file throws (surfaces the read error)', () => {
		expect(() =>
			resolveDatabaseEncryptionKey({
				DATABASE_ENCRYPTION_KEY_FILE: '/nope/does-not-exist.key',
			} as never),
		).toThrow();
	});

	it('LIBSQL-KEY-07: setting both inline and file is rejected', () => {
		const { dir, path } = tmpFile('k');
		try {
			writeFileSync(path, 'file-key\n');
			expect(() =>
				resolveDatabaseEncryptionKey({
					DATABASE_ENCRYPTION_KEY: 'inline',
					DATABASE_ENCRYPTION_KEY_FILE: path,
				} as never),
			).toThrow(/only one of/i);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('LIBSQL-KEY-08: a whitespace-only inline key + a real file → uses the file (inline is absent)', () => {
		const { dir, path } = tmpFile('k');
		try {
			writeFileSync(path, 'file-key\n');
			expect(
				resolveDatabaseEncryptionKey({
					DATABASE_ENCRYPTION_KEY: '   ',
					DATABASE_ENCRYPTION_KEY_FILE: path,
				} as never),
			).toBe('file-key');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('LIBSQL-KEY-09: production requires a key; dev/test return undefined', () => {
		expect(() => resolveDatabaseEncryptionKey({ NODE_ENV: 'production' } as never)).toThrow(
			/required in production/i,
		);
		expect(resolveDatabaseEncryptionKey({ NODE_ENV: 'development' } as never)).toBeUndefined();
		expect(resolveDatabaseEncryptionKey({ NODE_ENV: 'test' } as never)).toBeUndefined();
		expect(resolveDatabaseEncryptionKey({} as never)).toBeUndefined();
	});

	it('LIBSQL-KEY-10: production accepts a key sourced from a file', () => {
		const { dir, path } = tmpFile('k');
		try {
			writeFileSync(path, 'prod-file-key\n');
			expect(
				resolveDatabaseEncryptionKey({
					NODE_ENV: 'production',
					DATABASE_ENCRYPTION_KEY_FILE: path,
				} as never),
			).toBe('prod-file-key');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ──────────────────────────────────────────────────────────────────────────────
// databaseEncryptionMode
// ──────────────────────────────────────────────────────────────────────────────
describe('databaseEncryptionMode (LIBSQL-MODE)', () => {
	it('LIBSQL-MODE-01: encrypted with a key, plaintext without', () => {
		expect(databaseEncryptionMode({ DATABASE_ENCRYPTION_KEY: 'k' } as never)).toBe('encrypted');
		expect(databaseEncryptionMode({ NODE_ENV: 'development' } as never)).toBe('plaintext');
	});

	it('LIBSQL-MODE-02: propagates the production guard error (no silent plaintext)', () => {
		expect(() => databaseEncryptionMode({ NODE_ENV: 'production' } as never)).toThrow(
			/required in production/i,
		);
	});
});

// ──────────────────────────────────────────────────────────────────────────────
// createLibsqlClient / buildLibsqlAdapter
// ──────────────────────────────────────────────────────────────────────────────
describe('createLibsqlClient (LIBSQL-CLIENT)', () => {
	it('LIBSQL-CLIENT-01: opens a usable client for an explicit url + key (round-trips)', async () => {
		const { dir, path } = tmpFile(`${randomUUID()}.db`);
		const client = createLibsqlClient({ url: `file:${path}`, encryptionKey: 'k' });
		try {
			await client.execute('CREATE TABLE t(x TEXT)');
			await client.execute("INSERT INTO t(x) VALUES ('hi')");
			const r = await client.execute('SELECT x FROM t');
			expect(String(r.rows[0].x)).toBe('hi');
		} finally {
			client.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('LIBSQL-CLIENT-02: explicit encryptionKey:undefined opens a plaintext file', async () => {
		const { dir, path } = tmpFile(`${randomUUID()}.db`);
		const client = createLibsqlClient({ url: `file:${path}`, encryptionKey: undefined });
		try {
			await client.execute('CREATE TABLE t(x TEXT)');
			expect(existsSync(path)).toBe(true);
			// A second keyless client can read it back → confirms it is unencrypted.
			const keyless = createLibsqlClient({ url: `file:${path}`, encryptionKey: undefined });
			await expect(keyless.execute('SELECT COUNT(*) AS n FROM t')).resolves.toBeDefined();
			keyless.close();
		} finally {
			client.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('buildLibsqlAdapter (LIBSQL-ADAPTER)', () => {
	it('LIBSQL-ADAPTER-01: builds an adapter for a valid env', () => {
		expect(
			buildLibsqlAdapter({ DATABASE_URL: 'file:./x.db', NODE_ENV: 'test' } as never),
		).toBeDefined();
	});

	it('LIBSQL-ADAPTER-02: rejects a non-file url', () => {
		expect(() => buildLibsqlAdapter({ DATABASE_URL: 'postgres://x' } as never)).toThrow(
			/file: scheme/i,
		);
	});

	it('LIBSQL-ADAPTER-03: rejects a production env with no key', () => {
		expect(() =>
			buildLibsqlAdapter({ DATABASE_URL: 'file:./x.db', NODE_ENV: 'production' } as never),
		).toThrow(/required in production/i);
	});
});
