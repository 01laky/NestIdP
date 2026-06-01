import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { runMigrationsOnTestDb } from '../prisma/test-db.helper';
import { createTestSamlSession, createTestSpConnection } from '../prisma/test-fixtures';
import { SamlSessionCleanupService } from './saml-session-cleanup.service';

jest.setTimeout(60_000);

describe('SamlSessionCleanupService (SQLite)', () => {
	let prisma: PrismaClient;
	let service: SamlSessionCleanupService;
	let databaseUrl: string;
	let spConnectionId: string;

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-saml-clean-${randomUUID()}.db`);
		databaseUrl = `file:${tmpDb}`;
		runMigrationsOnTestDb(databaseUrl, 'sqlite');
		prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
		const configService = {
			get: () => 0,
		} as unknown as ConfigService;
		service = new SamlSessionCleanupService(prisma as unknown as PrismaService, configService);
		const sp = await createTestSpConnection(prisma);
		spConnectionId = sp.id;
	});

	afterAll(async () => {
		await prisma.$disconnect();
		try {
			unlinkSync(databaseUrl.replace(/^file:/, ''));
		} catch {
			// ignore
		}
	});

	it('API-SAML-CLEAN-01: deletes only expired rows', async () => {
		const expired = await createTestSamlSession(prisma, spConnectionId, {
			expiresAt: new Date(Date.now() - 60_000),
			samlRequestId: `_exp-${Date.now()}`,
		});
		const valid = await createTestSamlSession(prisma, spConnectionId, {
			expiresAt: new Date(Date.now() + 60_000),
			samlRequestId: `_valid-${Date.now()}`,
		});
		const count = await service.purgeExpiredSessions();
		expect(count).toBeGreaterThanOrEqual(1);
		expect(await prisma.samlSession.findUnique({ where: { id: expired.id } })).toBeNull();
		expect(await prisma.samlSession.findUnique({ where: { id: valid.id } })).not.toBeNull();
	});

	it('API-SAML-CLEAN-02: leaves valid session for SSO flow', async () => {
		const session = await createTestSamlSession(prisma, spConnectionId, {
			samlRequestId: `_keep-${Date.now()}`,
		});
		await service.purgeExpiredSessions();
		expect(await prisma.samlSession.findUnique({ where: { id: session.id } })).not.toBeNull();
	});

	it('API-SAML-CLEAN-03: startup purge via onModuleInit', async () => {
		await createTestSamlSession(prisma, spConnectionId, {
			expiresAt: new Date(Date.now() - 120_000),
			samlRequestId: `_startup-${Date.now()}`,
		});
		await service.onModuleInit();
		expect(await prisma.samlSession.count({ where: { expiresAt: { lt: new Date() } } })).toBe(0);
	});
});
