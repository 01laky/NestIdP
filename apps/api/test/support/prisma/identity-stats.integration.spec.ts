import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { AdminStatsService } from '@api/admin/services/admin-stats.service';
import { IdentityRepository } from '@api/identity/identity.repository';
import { IdentityService } from '@api/identity/services/identity.service';
import { ActiveIdentityStore } from '@api/identity/store/active-identity-store';
import {
	createTestAdminUser,
	createTestApiConnection,
	createTestGroup,
	createTestRole,
	createTestSpConnection,
	createTestUser,
} from '@test/support/prisma/test-fixtures';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';

jest.setTimeout(30_000);

describe('identity and admin stats integration (SQLite)', () => {
	let databaseUrl: string;
	let prisma: PrismaClient;
	let adminStatsService: AdminStatsService;

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-stats-${randomUUID()}.db`);
		databaseUrl = `file:${tmpDb}`;
		await runMigrationsOnTestDb(databaseUrl);
		prisma = new PrismaClient({
			datasources: { db: { url: databaseUrl } },
		});
		const identityService = new IdentityService(
			new ActiveIdentityStore(new IdentityRepository(prisma as never)),
		);
		adminStatsService = new AdminStatsService(identityService, prisma as never);
	});

	afterAll(async () => {
		await prisma.$disconnect();
		const filePath = databaseUrl.replace(/^file:/, '');
		try {
			unlinkSync(filePath);
		} catch {
			// ignore
		}
	});

	it('API-STA-01: returns numeric counts for all five fields', async () => {
		const counts = await adminStatsService.getCounts();
		expect(counts).toMatchObject({
			users: expect.any(Number),
			groups: expect.any(Number),
			roles: expect.any(Number),
			apiConnections: expect.any(Number),
			spConnections: expect.any(Number),
		});
		for (const value of Object.values(counts)) {
			expect(value).toBeGreaterThanOrEqual(0);
		}
	});

	it('API-STA-02: counts increase by inserted row deltas', async () => {
		const before = await adminStatsService.getCounts();
		const conn = await createTestApiConnection(prisma);
		await createTestUser(prisma, conn.id);
		await createTestUser(prisma, conn.id);
		await createTestGroup(prisma, conn.id);
		await createTestRole(prisma, conn.id);
		await createTestRole(prisma, conn.id);
		await createTestRole(prisma, conn.id);
		await createTestSpConnection(prisma);
		await createTestSpConnection(prisma);

		const after = await adminStatsService.getCounts();
		expect(after).toEqual({
			users: before.users + 2,
			groups: before.groups + 1,
			roles: before.roles + 3,
			apiConnections: before.apiConnections + 1,
			spConnections: before.spConnections + 2,
		});
	});

	it('API-STA-03: IdentityRepository counts match prisma direct counts', async () => {
		const repository = new IdentityRepository(prisma as never);
		const [users, groups, roles] = await Promise.all([
			repository.countUsers(),
			repository.countGroups(),
			repository.countRoles(),
		]);
		expect(users).toBe(await prisma.user.count());
		expect(groups).toBe(await prisma.group.count());
		expect(roles).toBe(await prisma.role.count());
	});

	it('API-STA-04: AdminUser rows do not affect identity counts', async () => {
		const before = await adminStatsService.getCounts();
		await createTestAdminUser(prisma);
		await createTestAdminUser(prisma);
		const after = await adminStatsService.getCounts();
		expect(after.users).toBe(before.users);
		expect(after.groups).toBe(before.groups);
		expect(after.roles).toBe(before.roles);
	});

	it('API-STA-05: same username on AdminUser and User is allowed (separate tables)', async () => {
		const conn = await createTestApiConnection(prisma);
		const sharedUsername = `shared-${randomUUID()}`;
		await createTestUser(prisma, conn.id, { username: sharedUsername });
		await expect(createTestAdminUser(prisma, { username: sharedUsername })).resolves.toBeDefined();
	});
});
