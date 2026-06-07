import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBootstrap } from '@api/bootstrap/run-bootstrap';
import { runMigrations } from '@api/prisma/db-migrator';
import { PrismaService } from '@api/prisma/services/prisma.service';

jest.setTimeout(30_000);

// OPS-11: the initial admin / IdP settings bootstrap must operate on an ENCRYPTED database through the
// libSQL driver adapter (PrismaService) — a plain PrismaClient would use the native engine and fail.
describe('bootstrap against an encrypted DB (OPS-11)', () => {
	const dbPath = join(tmpdir(), `nestidp-bootstrap-enc-${randomUUID()}.db`);
	const databaseUrl = `file:${dbPath}`;
	const encryptionKey = 'bootstrap-at-rest-key';
	let prisma: PrismaService;

	const logs: string[] = [];
	const logger = {
		log: (message: string) => logs.push(message),
		warn: (message: string) => logs.push(message),
	};

	beforeAll(async () => {
		await runMigrations({ url: databaseUrl, encryptionKey });
		prisma = new PrismaService({ url: databaseUrl, encryptionKey });
	});

	afterAll(async () => {
		await prisma.$disconnect();
		for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
			if (existsSync(f)) {
				rmSync(f);
			}
		}
	});

	it('OPS-11: creates exactly one admin and the IdpSettings singleton on the encrypted file', async () => {
		const result = await runBootstrap(
			prisma,
			{
				adminUsername: 'enc-admin',
				adminPassword: 'strong-encrypted-pass',
				idpBaseUrl: 'https://idp.example.com',
			},
			logger,
		);

		expect(result.adminCreated).toBe(true);
		expect(await prisma.adminUser.count()).toBe(1);
		const settings = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		expect(settings?.entityId).toBe('https://idp.example.com');

		// The file is genuinely encrypted: a keyless reopen cannot read it.
		const keyless = new PrismaService({ url: databaseUrl });
		await expect(keyless.adminUser.count()).rejects.toBeDefined();
		await keyless.$disconnect();
	});

	it('OPS-11: a second boot is idempotent (admin count stays 1)', async () => {
		await runBootstrap(
			prisma,
			{
				adminUsername: 'enc-admin',
				adminPassword: 'strong-encrypted-pass',
				idpBaseUrl: 'https://idp.example.com',
			},
			logger,
		);
		expect(await prisma.adminUser.count()).toBe(1);
	});
});
