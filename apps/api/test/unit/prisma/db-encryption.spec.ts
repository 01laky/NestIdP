import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { databaseEncryptionMode, resolveDatabaseEncryptionKey } from '@api/prisma/libsql';
import { setConnectionPragmas } from '@api/prisma/db-migrator';

const MARKER = 'ENC-MARKER-PLAINTEXT-VALUE';

function tmpDb(): string {
	return join(mkdtempSync(join(tmpdir(), 'nestidp-enc-')), `${randomUUID()}.db`);
}
function cleanup(path: string): void {
	for (const f of [path, `${path}-wal`, `${path}-shm`]) {
		if (existsSync(f)) rmSync(f);
	}
}
async function seed(path: string, key?: string): Promise<void> {
	const c = createClient(
		key ? { url: `file:${path}`, encryptionKey: key } : { url: `file:${path}` },
	);
	await c.execute('CREATE TABLE t(x TEXT)');
	await c.execute({ sql: 'INSERT INTO t(x) VALUES (?)', args: [MARKER] });
	c.close();
}
async function readMarker(path: string, key?: string): Promise<string> {
	const c = createClient(
		key ? { url: `file:${path}`, encryptionKey: key } : { url: `file:${path}` },
	);
	try {
		const r = await c.execute('SELECT x FROM t LIMIT 1');
		return String(r.rows[0]?.x ?? '');
	} finally {
		c.close();
	}
}

describe('database encryption (libSQL)', () => {
	it('ENC-01: same key round-trips the data', async () => {
		const db = tmpDb();
		try {
			await seed(db, 'key-A');
			await expect(readMarker(db, 'key-A')).resolves.toBe(MARKER);
		} finally {
			cleanup(db);
		}
	});

	it('ENC-02: a wrong key cannot read an encrypted DB', async () => {
		const db = tmpDb();
		try {
			await seed(db, 'key-A');
			await expect(readMarker(db, 'wrong-key')).rejects.toBeDefined();
		} finally {
			cleanup(db);
		}
	});

	it('ENC-03: no key cannot read an encrypted DB', async () => {
		const db = tmpDb();
		try {
			await seed(db, 'key-A');
			await expect(readMarker(db, undefined)).rejects.toBeDefined();
		} finally {
			cleanup(db);
		}
	});

	it('ENC-04: a plaintext DB (no key) is readable without a key', async () => {
		const db = tmpDb();
		try {
			await seed(db, undefined);
			await expect(readMarker(db, undefined)).resolves.toBe(MARKER);
		} finally {
			cleanup(db);
		}
	});

	it('ENC-05: raw file bytes of an encrypted DB do not leak the plaintext marker', async () => {
		const db = tmpDb();
		try {
			await seed(db, 'key-A');
			const raw = readFileSync(db);
			expect(raw.includes(Buffer.from(MARKER))).toBe(false);
		} finally {
			cleanup(db);
		}
	});

	it('OPS-01: rekey (PRAGMA rekey) — old key stops working, new key works', async () => {
		const db = tmpDb();
		try {
			await seed(db, 'old-key');
			const c = createClient({ url: `file:${db}`, encryptionKey: 'old-key' });
			await c.execute("PRAGMA rekey='new-key'");
			c.close();
			await expect(readMarker(db, 'new-key')).resolves.toBe(MARKER);
			await expect(readMarker(db, 'old-key')).rejects.toBeDefined();
		} finally {
			cleanup(db);
		}
	});

	it('OPS-02: backup (VACUUM INTO) produces an encrypted copy readable with the same key', async () => {
		const db = tmpDb();
		const backup = tmpDb();
		try {
			await seed(db, 'key-A');
			const c = createClient({ url: `file:${db}`, encryptionKey: 'key-A' });
			await c.execute(`VACUUM INTO 'file:${backup}'`);
			c.close();
			await expect(readMarker(backup, 'key-A')).resolves.toBe(MARKER);
			await expect(readMarker(backup, undefined)).rejects.toBeDefined();
		} finally {
			cleanup(db);
			cleanup(backup);
		}
	});
});

describe('connection pragmas (OPS-07)', () => {
	it('OPS-07: WAL journal mode and foreign-key enforcement are active after setConnectionPragmas', async () => {
		const db = tmpDb();
		const c = createClient({ url: `file:${db}` });
		try {
			await setConnectionPragmas(c);

			const journal = await c.execute('PRAGMA journal_mode');
			expect(String(Object.values(journal.rows[0])[0]).toLowerCase()).toBe('wal');

			const fk = await c.execute('PRAGMA foreign_keys');
			expect(Number(Object.values(fk.rows[0])[0])).toBe(1);

			// A real FK violation must be rejected (RESTRICT semantics enforced).
			await c.execute('CREATE TABLE parent (id INTEGER PRIMARY KEY)');
			await c.execute(
				'CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id))',
			);
			await expect(
				c.execute('INSERT INTO child (id, parent_id) VALUES (1, 999)'),
			).rejects.toBeDefined();
		} finally {
			c.close();
			cleanup(db);
		}
	});
});

describe('resolveDatabaseEncryptionKey', () => {
	it('KEY-01: inline key', () => {
		expect(resolveDatabaseEncryptionKey({ DATABASE_ENCRYPTION_KEY: '  k  ' } as never)).toBe('k');
	});

	it('KEY-02: key file is read and trailing newline trimmed', () => {
		const dir = mkdtempSync(join(tmpdir(), 'nestidp-key-'));
		const file = join(dir, 'dbkey');
		writeFileSync(file, 'file-key\n');
		try {
			expect(resolveDatabaseEncryptionKey({ DATABASE_ENCRYPTION_KEY_FILE: file } as never)).toBe(
				'file-key',
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('KEY-03: both inline and file → error', () => {
		expect(() =>
			resolveDatabaseEncryptionKey({
				DATABASE_ENCRYPTION_KEY: 'k',
				DATABASE_ENCRYPTION_KEY_FILE: '/x',
			} as never),
		).toThrow(/only one of/i);
	});

	it('KEY-04 / OPS-05: production requires a key; non-prod returns undefined', () => {
		expect(() => resolveDatabaseEncryptionKey({ NODE_ENV: 'production' } as never)).toThrow(
			/required in production/i,
		);
		expect(resolveDatabaseEncryptionKey({ NODE_ENV: 'development' } as never)).toBeUndefined();
	});

	it('OPS-06: an empty key file is rejected', () => {
		const dir = mkdtempSync(join(tmpdir(), 'nestidp-key-'));
		const file = join(dir, 'dbkey');
		writeFileSync(file, '\n');
		try {
			expect(() =>
				resolveDatabaseEncryptionKey({ DATABASE_ENCRYPTION_KEY_FILE: file } as never),
			).toThrow(/empty/i);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('databaseEncryptionMode (OPS-05)', () => {
	it('OPS-05: reports "encrypted" with a key and "plaintext" without one', () => {
		expect(databaseEncryptionMode({ DATABASE_ENCRYPTION_KEY: 'k' } as never)).toBe('encrypted');
		expect(databaseEncryptionMode({ NODE_ENV: 'development' } as never)).toBe('plaintext');
	});
});
