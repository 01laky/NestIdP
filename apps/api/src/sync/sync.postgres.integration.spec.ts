import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_PASSWORD_HASH_ALGORITHM, SYNC_API_PATH } from '@nestidp/shared';
import { clearApiConnectionScopedTestData, runMigrationsOnTestDb } from '../prisma/test-db.helper';
import { createTestApiConnection, TEST_PASSWORD_HASH } from '../prisma/test-fixtures';
import { SyncService } from './sync.service';
import { SyncLogService } from './sync-log.service';
import { IdentitySyncClientService } from './identity-sync-client.service';
import { IdentityRepository } from '../identity/identity.repository';
import { EncryptionService } from '../encryption/encryption.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

const postgresTestUrl = process.env.POSTGRES_TEST_URL;

jest.setTimeout(60_000);

(postgresTestUrl ? describe : describe.skip)('sync integration (PostgreSQL)', () => {
	let prisma: PrismaClient;

	beforeAll(async () => {
		runMigrationsOnTestDb(postgresTestUrl!, 'postgresql');
		prisma = new PrismaClient({ datasources: { db: { url: postgresTestUrl } } });
		await clearApiConnectionScopedTestData(prisma);
	});

	afterAll(async () => {
		await prisma.$disconnect();
	});

	it('API-SYNC-PG-01: SyncLog JSON errors column round-trip on PostgreSQL', async () => {
		const connection = await createTestApiConnection(prisma, { bearerToken: 'pg-sync-token' });
		const log = await prisma.syncLog.create({
			data: {
				apiConnectionId: connection.id,
				status: 'FAILED',
				finishedAt: new Date(),
				errors: [
					{
						phase: 'fetch_users',
						message: 'Identity API returned HTTP 500',
						httpStatus: 500,
					},
				],
			},
		});

		const loaded = await prisma.syncLog.findUnique({ where: { id: log.id } });
		expect(Array.isArray(loaded?.errors)).toBe(true);
		expect((loaded?.errors as { phase: string }[])[0].phase).toBe('fetch_users');
	});

	it('API-SYNC-PG-02: happy path sync upserts user on PostgreSQL', async () => {
		const connection = await createTestApiConnection(prisma, {
			name: `PG Sync ${randomUUID()}`,
			baseUrl: 'https://identity.example.com',
			bearerToken: 'pg-sync-token',
		});

		const config = new ConfigService({
			ENCRYPTION_KEY: 'test-encryption-key-32chars!!',
		});
		const encryption = new EncryptionService(config);
		const identityRepository = new IdentityRepository(prisma as unknown as PrismaService);
		const syncLogService = new SyncLogService(prisma as unknown as PrismaService);
		const identitySyncClient = new IdentitySyncClientService(config);

		const audit = { recordSafe: jest.fn() };
		const syncService = new SyncService(
			prisma as unknown as PrismaService,
			identityRepository,
			syncLogService,
			identitySyncClient,
			encryption,
			audit as never,
		);

		jest.spyOn(identitySyncClient, 'fetchUsersRaw').mockResolvedValue([
			{
				id: 'usr_pg',
				username: 'pguser',
				email: 'pg@example.com',
				displayName: 'PG User',
				passwordHash: TEST_PASSWORD_HASH,
				passwordHashAlgorithm: DEFAULT_PASSWORD_HASH_ALGORITHM,
				active: true,
			},
		]);
		jest.spyOn(identitySyncClient, 'fetchGroupsForUser').mockResolvedValue([]);
		jest.spyOn(identitySyncClient, 'fetchRolesForUser').mockResolvedValue([]);

		const result = await syncService.triggerSync(connection.id);
		expect(result.syncLog.status).toBe('SUCCESS');
		expect(await prisma.user.count({ where: { apiConnectionId: connection.id } })).toBe(1);
		expect(SYNC_API_PATH).toBe('/api/admin/sync');
	});
});
