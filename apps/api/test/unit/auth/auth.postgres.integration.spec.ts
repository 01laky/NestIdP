import { PrismaClient } from '@prisma/client';
import {
	clearApiConnectionScopedTestData,
	runMigrationsOnTestDb,
} from '@test/support/prisma/test-db.helper';
import {
	createTestApiConnection,
	createTestUserWithPassword,
} from '@test/support/prisma/test-fixtures';

const postgresTestUrl = process.env.POSTGRES_TEST_URL;

jest.setTimeout(60_000);

(postgresTestUrl ? describe : describe.skip)('end-user auth integration (PostgreSQL)', () => {
	let prisma: PrismaClient;

	beforeAll(async () => {
		runMigrationsOnTestDb(postgresTestUrl!, 'postgresql');
		prisma = new PrismaClient({ datasources: { db: { url: postgresTestUrl } } });
		await clearApiConnectionScopedTestData(prisma);
	});

	afterAll(async () => {
		await prisma.$disconnect();
	});

	it('API-AUTH-PG-01: createTestUserWithPassword stores verifiable bcrypt hash on PostgreSQL', async () => {
		const connection = await createTestApiConnection(prisma);
		const user = await createTestUserWithPassword(
			prisma,
			connection.id,
			'pg-end-user',
			'pg-pass-12345',
		);
		expect(user.username).toBe('pg-end-user');
		const { verifyPassword } = await import('@api/admin-auth/utils/password.util');
		expect(await verifyPassword('pg-pass-12345', user.passwordHash)).toBe(true);
		expect(user.passwordHash).toMatch(/^\$2/);
	});
});
