import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '@api/admin-auth/utils/password.util';
import { runBootstrap } from '@api/bootstrap/run-bootstrap';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';
import { createTestAdminUser } from '@test/support/prisma/test-fixtures';

jest.setTimeout(30_000);

describe('bootstrap integration (SQLite)', () => {
	let databaseUrl: string;
	let prisma: PrismaClient;
	const logs: string[] = [];
	const warnings: string[] = [];
	const logger = {
		log: (message: string) => logs.push(message),
		warn: (message: string) => warnings.push(message),
	};

	beforeEach(async () => {
		logs.length = 0;
		warnings.length = 0;
		const tmpDb = join(tmpdir(), `nestidp-bootstrap-${randomUUID()}.db`);
		databaseUrl = `file:${tmpDb}`;
		await runMigrationsOnTestDb(databaseUrl);
		prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
	});

	afterEach(async () => {
		await prisma.$disconnect();
		const filePath = databaseUrl.replace(/^file:/, '');
		try {
			unlinkSync(filePath);
		} catch {
			// ignore
		}
	});

	it('API-BST-01: Zero admins + env set → creates exactly one AdminUser', async () => {
		const result = await runBootstrap(
			prisma,
			{
				adminUsername: 'bootstrap-admin',
				adminPassword: 'strong-bootstrap-pass',
				idpBaseUrl: 'https://idp.example.com',
			},
			logger,
		);

		expect(result.adminCreated).toBe(true);
		expect(await prisma.adminUser.count()).toBe(1);
	});

	it('API-BST-02: Admin exists → second boot skips, count stays 1', async () => {
		await runBootstrap(
			prisma,
			{
				adminUsername: 'bootstrap-admin',
				adminPassword: 'strong-bootstrap-pass',
				idpBaseUrl: 'https://idp.example.com',
			},
			logger,
		);
		await runBootstrap(
			prisma,
			{
				adminUsername: 'other',
				adminPassword: 'other-strong-pass',
				idpBaseUrl: 'https://idp.example.com',
			},
			logger,
		);

		expect(await prisma.adminUser.count()).toBe(1);
		expect(logs.some((line) => line.includes('skipping admin seed'))).toBe(true);
	});

	it('API-BST-03: Missing ADMIN_PASSWORD → no admin created', async () => {
		await runBootstrap(
			prisma,
			{
				adminUsername: 'admin-only',
				idpBaseUrl: 'https://idp.example.com',
			},
			logger,
		);
		expect(await prisma.adminUser.count()).toBe(0);
	});

	it('API-BST-04: Empty string username/password → no admin created', async () => {
		await runBootstrap(
			prisma,
			{
				adminUsername: '',
				adminPassword: '',
				idpBaseUrl: 'https://idp.example.com',
			},
			logger,
		);
		expect(await prisma.adminUser.count()).toBe(0);
	});

	it('API-BST-05: Created admin has bcrypt hash ≠ plaintext', async () => {
		await runBootstrap(
			prisma,
			{
				adminUsername: 'hash-check',
				adminPassword: 'plain-text-password',
				idpBaseUrl: 'https://idp.example.com',
			},
			logger,
		);
		const admin = await prisma.adminUser.findFirst();
		expect(admin?.passwordHash).not.toBe('plain-text-password');
		expect(admin?.passwordHash.startsWith('$2')).toBe(true);
	});

	it('API-BST-06: No IdpSettings → creates default row with entityId', async () => {
		await runBootstrap(prisma, { idpBaseUrl: 'https://idp.example.com' }, logger);
		const settings = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		expect(settings?.entityId).toBe('https://idp.example.com');
	});

	it('API-BST-07: IdpSettings exists → bootstrap does not duplicate', async () => {
		await runBootstrap(prisma, { idpBaseUrl: 'https://idp-a.example.com' }, logger);
		await runBootstrap(prisma, { idpBaseUrl: 'https://idp-b.example.com' }, logger);
		expect(await prisma.idpSettings.count()).toBe(1);
		const settings = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		expect(settings?.entityId).toBe('https://idp-a.example.com');
	});

	it('API-BST-08: Bootstrap runs twice → still one admin + one settings row', async () => {
		await runBootstrap(
			prisma,
			{
				adminUsername: 'once',
				adminPassword: 'strong-bootstrap-pass',
				idpBaseUrl: 'https://idp.example.com',
			},
			logger,
		);
		await runBootstrap(
			prisma,
			{
				adminUsername: 'once',
				adminPassword: 'strong-bootstrap-pass',
				idpBaseUrl: 'https://idp.example.com',
			},
			logger,
		);
		expect(await prisma.adminUser.count()).toBe(1);
		expect(await prisma.idpSettings.count()).toBe(1);
	});

	it('API-BST-09: Admin exists + no IdpSettings → creates IdpSettings only', async () => {
		await createTestAdminUser(prisma);
		const result = await runBootstrap(prisma, { idpBaseUrl: 'https://idp.example.com' }, logger);
		expect(result.adminCreated).toBe(false);
		expect(result.idpSettingsCreated).toBe(true);
	});

	it('API-BST-10: ADMIN_* unset + empty DB → no admin, IdpSettings created', async () => {
		const result = await runBootstrap(prisma, { idpBaseUrl: 'https://idp.example.com' }, logger);
		expect(result.adminCreated).toBe(false);
		expect(result.idpSettingsCreated).toBe(true);
		expect(await prisma.adminUser.count()).toBe(0);
	});

	it('API-BST-11: whitespace-only credentials → no admin created', async () => {
		await runBootstrap(
			prisma,
			{
				adminUsername: '   ',
				adminPassword: '   ',
				idpBaseUrl: 'https://idp.example.com',
			},
			logger,
		);
		expect(await prisma.adminUser.count()).toBe(0);
	});

	it('API-BST-12: weak password in development logs warning and still creates admin', async () => {
		await runBootstrap(
			prisma,
			{
				adminUsername: 'dev-admin',
				adminPassword: 'changeme',
				idpBaseUrl: 'https://idp.example.com',
				nodeEnv: 'development',
			},
			logger,
		);
		expect(warnings.some((line) => line.includes('weak value'))).toBe(true);
		expect(await prisma.adminUser.count()).toBe(1);
	});

	it('API-BST-13: production + weak password throws', async () => {
		await expect(
			runBootstrap(
				prisma,
				{
					adminUsername: 'prod-admin',
					adminPassword: 'changeme',
					idpBaseUrl: 'https://idp.example.com',
					nodeEnv: 'production',
				},
				logger,
			),
		).rejects.toThrow(/weak ADMIN_PASSWORD/);
	});

	it('API-BST-14: production + strong password creates admin', async () => {
		await runBootstrap(
			prisma,
			{
				adminUsername: 'prod-admin',
				adminPassword: 'production-strong-pass',
				idpBaseUrl: 'https://idp.example.com',
				nodeEnv: 'production',
			},
			logger,
		);
		expect(await prisma.adminUser.count()).toBe(1);
	});

	it('API-BST-15: production + missing password throws', async () => {
		await expect(
			runBootstrap(
				prisma,
				{
					idpBaseUrl: 'https://idp.example.com',
					nodeEnv: 'production',
				},
				logger,
			),
		).rejects.toThrow(/without ADMIN_PASSWORD/);
	});

	it('hashPassword used by fixture helper produces verifiable hash', async () => {
		const hash = await hashPassword('fixture-test');
		expect(hash.startsWith('$2')).toBe(true);
	});

	it('API-BST-16: only ADMIN_PASSWORD set → no admin created', async () => {
		await runBootstrap(
			prisma,
			{
				adminPassword: 'strong-password-only',
				idpBaseUrl: 'https://idp.example.com',
			},
			logger,
		);
		expect(await prisma.adminUser.count()).toBe(0);
		expect(warnings.some((line) => line.includes('incomplete'))).toBe(true);
	});

	it('API-BST-17: short password (11 chars) warns in development', async () => {
		await runBootstrap(
			prisma,
			{
				adminUsername: 'short-pass-admin',
				adminPassword: ' elevenchars',
				idpBaseUrl: 'https://idp.example.com',
				nodeEnv: 'development',
			},
			logger,
		);
		expect(warnings.some((line) => line.includes('weak value'))).toBe(true);
		expect(await prisma.adminUser.count()).toBe(1);
	});

	it('API-BST-18: production with existing admin does not throw on weak env', async () => {
		await createTestAdminUser(prisma);
		await expect(
			runBootstrap(
				prisma,
				{
					adminUsername: 'ignored',
					adminPassword: 'changeme',
					idpBaseUrl: 'https://idp.example.com',
					nodeEnv: 'production',
				},
				logger,
			),
		).resolves.toMatchObject({ adminCreated: false, idpSettingsCreated: true });
	});

	it('API-BST-19: username with surrounding whitespace is trimmed on insert', async () => {
		await runBootstrap(
			prisma,
			{
				adminUsername: '  trimmed-admin  ',
				adminPassword: 'strong-bootstrap-pass',
				idpBaseUrl: 'https://idp.example.com',
			},
			logger,
		);
		const admin = await prisma.adminUser.findFirst();
		expect(admin?.username).toBe('trimmed-admin');
	});

	it('API-BST-IDP-01: bootstrap does not overwrite existing entityId when IDP_BASE_URL changes', async () => {
		await runBootstrap(prisma, { idpBaseUrl: 'https://original-idp.example.com' }, logger);
		const original = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		await runBootstrap(prisma, { idpBaseUrl: 'https://changed-idp.example.com' }, logger);
		const after = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		expect(after?.entityId).toBe(original?.entityId);
		expect(after?.entityId).toBe('https://original-idp.example.com');
	});

	it('API-BST-IDP-02: fresh bootstrap creates IdpSettings without signing cert fields', async () => {
		await runBootstrap(prisma, { idpBaseUrl: 'https://fresh-idp.example.com' }, logger);
		const settings = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		expect(settings?.entityId).toBe('https://fresh-idp.example.com');
		expect(settings?.signingCertPem).toBeNull();
		expect(settings?.signingKeyEncrypted).toBeNull();
		expect(settings?.pendingSigningCertPem).toBeNull();
		expect(settings?.pendingSigningKeyEncrypted).toBeNull();
	});
});
