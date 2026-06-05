import { PrismaClient } from '@prisma/client';
import { clearApiConnectionScopedTestData, runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';
import { createTestApiConnection } from '@test/support/prisma/test-fixtures';

const postgresTestUrl = process.env.POSTGRES_TEST_URL;

jest.setTimeout(60_000);

(postgresTestUrl ? describe : describe.skip)('api-connections integration (PostgreSQL)', () => {
	let prisma: PrismaClient;

	beforeAll(async () => {
		runMigrationsOnTestDb(postgresTestUrl!, 'postgresql');
		prisma = new PrismaClient({ datasources: { db: { url: postgresTestUrl } } });
		await clearApiConnectionScopedTestData(prisma);
	});

	afterAll(async () => {
		await prisma.$disconnect();
	});

	it('API-CON-PG-01: createTestApiConnection with bearerToken encrypts on PostgreSQL', async () => {
		const connection = await createTestApiConnection(prisma, {
			name: 'PG API',
			baseUrl: 'https://pg.example.com',
			bearerToken: 'pg-bearer-token',
		});

		expect(connection.name).toBe('PG API');
		expect(connection.authCredentialsEncrypted.startsWith('v1:')).toBe(true);
		expect(connection.authCredentialsEncrypted).not.toBe('pg-bearer-token');

		const listed = await prisma.apiConnection.findMany();
		expect(listed.some((row) => row.id === connection.id)).toBe(true);

		await prisma.apiConnection.delete({ where: { id: connection.id } });
	});
});
