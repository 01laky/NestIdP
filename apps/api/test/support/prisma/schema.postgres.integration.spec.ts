import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createTestApiConnection, createTestUser } from '@test/support/prisma/test-fixtures';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';

const postgresTestUrl = process.env.POSTGRES_TEST_URL;

jest.setTimeout(60_000);

(postgresTestUrl ? describe : describe.skip)('schema integration (PostgreSQL)', () => {
	let prisma: PrismaClient;

	beforeAll(() => {
		runMigrationsOnTestDb(postgresTestUrl!, 'postgresql');
		prisma = new PrismaClient({
			datasources: { db: { url: postgresTestUrl } },
		});
	});

	afterAll(async () => {
		await prisma.$disconnect();
	});

	it('API-PG-01: migrate deploy succeeds on PostgreSQL', async () => {
		const migrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
				SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1
			`;
		expect(migrations.length).toBeGreaterThan(0);
	});

	it('API-PG-02: smoke insert via fixtures on PostgreSQL', async () => {
		const connection = await createTestApiConnection(prisma, {
			name: `PG Test ${randomUUID()}`,
		});
		const user = await createTestUser(prisma, connection.id, {
			username: `pg-user-${randomUUID()}`,
		});

		const loaded = await prisma.user.findUnique({ where: { id: user.id } });
		expect(loaded?.username).toBe(user.username);
	});

	it('API-PG-03: username unique constraint enforced on PostgreSQL', async () => {
		const connection = await createTestApiConnection(prisma);
		const username = `pg-dup-${randomUUID()}`;
		await createTestUser(prisma, connection.id, { username });

		await expect(
			createTestUser(prisma, connection.id, {
				username,
				externalId: 'other',
			}),
		).rejects.toThrow();
	});
});
