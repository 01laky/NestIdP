import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createClient } from '@libsql/client';

// Exercises the real maintenance CLI (apps/api/scripts/db-cli.mjs) end-to-end so the dump/restore,
// backup, and rekey operations are covered against an actually-encrypted file.

const apiRoot = resolve(__dirname, '../../..');
const cli = join(apiRoot, 'scripts/db-cli.mjs');

jest.setTimeout(30_000);

function tmpDir(): string {
	return mkdtempSync(join(tmpdir(), 'nestidp-cli-'));
}

function runCli(args: string[], env: Record<string, string>): void {
	execFileSync('node', [cli, ...args], {
		cwd: apiRoot,
		env: { ...process.env, ...env },
		stdio: 'pipe',
	});
}

/** Run the CLI expecting a non-zero exit; returns the captured stderr. */
function runCliExpectFail(args: string[], env: Record<string, string>): string {
	try {
		execFileSync('node', [cli, ...args], {
			cwd: apiRoot,
			env: { ...process.env, ...env },
			stdio: 'pipe',
		});
		throw new Error('expected the CLI to exit non-zero');
	} catch (error) {
		const e = error as { status?: number; stderr?: Buffer };
		if (typeof e.status !== 'number') {
			throw error;
		}
		expect(e.status).not.toBe(0);
		return e.stderr ? e.stderr.toString() : '';
	}
}

async function seed(url: string, key: string): Promise<void> {
	const c = createClient({ url, encryptionKey: key });
	await c.execute('CREATE TABLE widget (id INTEGER PRIMARY KEY, name TEXT)');
	await c.execute("INSERT INTO widget (id, name) VALUES (1, 'alpha'), (2, 'beta')");
	c.close();
}

async function names(url: string, key?: string): Promise<string[]> {
	const c = createClient(key ? { url, encryptionKey: key } : { url });
	try {
		const r = await c.execute('SELECT name FROM widget ORDER BY id');
		return r.rows.map((row) => String(row.name));
	} finally {
		c.close();
	}
}

describe('db-cli maintenance commands', () => {
	let dir: string;

	beforeEach(() => {
		dir = tmpDir();
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('OPS-03: dump (keyed → .sql) then restore (.sql → fresh keyed file) round-trips data', async () => {
		const srcPath = join(dir, `${randomUUID()}.db`);
		const dumpPath = join(dir, 'dump.sql');
		const restorePath = join(dir, `${randomUUID()}.db`);
		await seed(`file:${srcPath}`, 'key-A');

		runCli(['dump', dumpPath], {
			DATABASE_URL: `file:${srcPath}`,
			DATABASE_ENCRYPTION_KEY: 'key-A',
		});
		expect(existsSync(dumpPath)).toBe(true);

		runCli(['restore', dumpPath], {
			DATABASE_URL: `file:${restorePath}`,
			DATABASE_ENCRYPTION_KEY: 'key-B',
		});

		await expect(names(`file:${restorePath}`, 'key-B')).resolves.toEqual(['alpha', 'beta']);
		// The restored file is encrypted with the new key — keyless open fails.
		await expect(names(`file:${restorePath}`, undefined)).rejects.toBeDefined();
	});

	it('OPS-02: backup (VACUUM INTO) produces an encrypted copy readable with the same key', async () => {
		const srcPath = join(dir, `${randomUUID()}.db`);
		const backupPath = join(dir, `${randomUUID()}.db`);
		await seed(`file:${srcPath}`, 'key-A');

		runCli(['backup', backupPath], {
			DATABASE_URL: `file:${srcPath}`,
			DATABASE_ENCRYPTION_KEY: 'key-A',
		});

		await expect(names(`file:${backupPath}`, 'key-A')).resolves.toEqual(['alpha', 'beta']);
		await expect(names(`file:${backupPath}`, undefined)).rejects.toBeDefined();
	});

	it('OPS-01: rekey re-encrypts the file — new key opens it, old key does not', async () => {
		const srcPath = join(dir, `${randomUUID()}.db`);
		await seed(`file:${srcPath}`, 'old-key');

		runCli(['rekey', '--new', 'new-key'], {
			DATABASE_URL: `file:${srcPath}`,
			DATABASE_ENCRYPTION_KEY: 'old-key',
		});

		await expect(names(`file:${srcPath}`, 'new-key')).resolves.toEqual(['alpha', 'beta']);
		await expect(names(`file:${srcPath}`, 'old-key')).rejects.toBeDefined();
	});

	it('CLI-MIG-01: the migrate command applies the committed migrations and is idempotent', async () => {
		const dbPath = join(dir, `${randomUUID()}.db`);
		const env = { DATABASE_URL: `file:${dbPath}`, DATABASE_ENCRYPTION_KEY: 'mig-key' };

		runCli(['migrate'], env);
		// The real schema is now present — the User table exists.
		const c1 = createClient({ url: `file:${dbPath}`, encryptionKey: 'mig-key' });
		const tables = await c1.execute(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='User'",
		);
		const firstCount = await c1.execute('SELECT COUNT(*) AS n FROM __app_migrations');
		c1.close();
		expect(tables.rows.length).toBe(1);

		// Second migrate run is a no-op: the applied count does not change.
		runCli(['migrate'], env);
		const c2 = createClient({ url: `file:${dbPath}`, encryptionKey: 'mig-key' });
		const secondCount = await c2.execute('SELECT COUNT(*) AS n FROM __app_migrations');
		c2.close();
		expect(Number(secondCount.rows[0].n)).toBe(Number(firstCount.rows[0].n));
	});

	describe('CLI error paths', () => {
		it('CLI-ERR-01: an unknown command exits non-zero', () => {
			const err = runCliExpectFail(['frobnicate'], { DATABASE_URL: `file:${join(dir, 'x.db')}` });
			expect(err).toMatch(/unknown command/i);
		});

		it('CLI-ERR-02: rekey without a new key exits non-zero', () => {
			const p = join(dir, `${randomUUID()}.db`);
			const err = runCliExpectFail(['rekey'], {
				DATABASE_URL: `file:${p}`,
				DATABASE_ENCRYPTION_KEY: 'k',
			});
			expect(err).toMatch(/--new/);
		});

		it('CLI-ERR-03: backup / dump without an output path exit non-zero', () => {
			const p = join(dir, `${randomUUID()}.db`);
			runCliExpectFail(['backup'], { DATABASE_URL: `file:${p}`, DATABASE_ENCRYPTION_KEY: 'k' });
			runCliExpectFail(['dump'], { DATABASE_URL: `file:${p}`, DATABASE_ENCRYPTION_KEY: 'k' });
		});

		it('CLI-ERR-04: restore with a missing input file exits non-zero', () => {
			const p = join(dir, `${randomUUID()}.db`);
			const err = runCliExpectFail(['restore', join(dir, 'nope.sql')], {
				DATABASE_URL: `file:${p}`,
				DATABASE_ENCRYPTION_KEY: 'k',
			});
			expect(err).toMatch(/existing .*\.sql|requires/i);
		});

		it('CLI-ERR-05: a non-file DATABASE_URL is rejected', () => {
			const err = runCliExpectFail(['migrate'], { DATABASE_URL: 'postgresql://localhost/db' });
			expect(err).toMatch(/file: scheme/i);
		});

		it('CLI-ERR-06: setting both key env and key file is rejected', () => {
			const p = join(dir, `${randomUUID()}.db`);
			const err = runCliExpectFail(['migrate'], {
				DATABASE_URL: `file:${p}`,
				DATABASE_ENCRYPTION_KEY: 'k',
				DATABASE_ENCRYPTION_KEY_FILE: '/some/file',
			});
			expect(err).toMatch(/only one of/i);
		});
	});
});
