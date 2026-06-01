import { PrismaClient } from '@prisma/client';
import { runBootstrap } from '../bootstrap/run-bootstrap';
import { runMigrationsOnTestDb } from '../prisma/test-db.helper';
import { createTestAdminUserWithPassword } from '../prisma/test-fixtures';

const postgresTestUrl = process.env.POSTGRES_TEST_URL;

jest.setTimeout(60_000);

(postgresTestUrl ? describe : describe.skip)('admin-auth integration (PostgreSQL)', () => {
	let prisma: PrismaClient;
	const adminPassword = 'postgres-admin-pass-123';

	beforeAll(async () => {
		runMigrationsOnTestDb(postgresTestUrl!, 'postgresql');
		prisma = new PrismaClient({ datasources: { db: { url: postgresTestUrl } } });
		await prisma.adminUser.deleteMany();
		await prisma.idpSettings.deleteMany();
		await runBootstrap(
			prisma,
			{
				adminUsername: 'pg-admin',
				adminPassword,
				idpBaseUrl: 'https://idp.postgres.example.com',
				nodeEnv: 'test',
			},
			console,
		);
	});

	afterAll(async () => {
		await prisma.$disconnect();
	});

	it('API-AUTH-PG-01: admin user and IdpSettings exist after bootstrap on PostgreSQL', async () => {
		const admin = await prisma.adminUser.findUnique({ where: { username: 'pg-admin' } });
		const settings = await prisma.idpSettings.findUnique({ where: { id: 'default' } });
		expect(admin).not.toBeNull();
		expect(settings?.entityId).toBe('https://idp.postgres.example.com');
	});

	it('API-AUTH-PG-02: createTestAdminUserWithPassword works on PostgreSQL', async () => {
		const admin = await createTestAdminUserWithPassword(
			prisma,
			'pg-fixture-admin',
			'fixture-pass-12345',
		);
		expect(admin.username).toBe('pg-fixture-admin');
	});
});
