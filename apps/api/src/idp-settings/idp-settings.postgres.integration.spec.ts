import { PrismaClient } from '@prisma/client';
import { runMigrationsOnTestDb } from '../prisma/test-db.helper';
import { createTestIdpSettingsWithEncryptionKey } from '../prisma/test-fixtures';

const postgresTestUrl = process.env.POSTGRES_TEST_URL;

jest.setTimeout(60_000);

(postgresTestUrl ? describe : describe.skip)('IdP settings encryption (PostgreSQL)', () => {
	let prisma: PrismaClient;

	beforeAll(async () => {
		runMigrationsOnTestDb(postgresTestUrl!, 'postgresql');
		prisma = new PrismaClient({ datasources: { db: { url: postgresTestUrl } } });
	});

	afterAll(async () => {
		await prisma.$disconnect();
	});

	it('API-IDP-PG-ENC-01: createTestIdpSettingsWithEncryptionKey persists encryption columns', async () => {
		await prisma.idpSettings.deleteMany();
		const settings = await createTestIdpSettingsWithEncryptionKey(prisma, {
			entityId: 'https://pg-idp.example.com',
		});
		expect(settings.encryptionCertPem).toContain('BEGIN CERTIFICATE');
		expect(settings.encryptionKeyEncrypted).toBeTruthy();
		expect(settings.encryptionKeyFamily).toBe('rsa');
		expect(settings.encryptionRsaModulusBits).toBe(2048);
	});
});
