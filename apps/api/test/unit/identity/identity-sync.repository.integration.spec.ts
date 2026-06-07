import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_PASSWORD_HASH_ALGORITHM } from '@nestidp/shared';
import { PrismaService } from '@api/prisma/services/prisma.service';
import {
	createTestApiConnection,
	createTestGroup,
	createTestRole,
	createTestUser,
	TEST_PASSWORD_HASH,
} from '@test/support/prisma/test-fixtures';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';
import {
	GroupNameCollisionError,
	IdentityRepository,
	RoleNameCollisionError,
	UsernameCollisionError,
} from '@api/identity/identity.repository';

jest.setTimeout(60_000);

describe('IdentityRepository sync methods (SQLite)', () => {
	let prisma: PrismaClient;
	let repository: IdentityRepository;
	let databaseUrl: string;
	let connectionId: string;

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-idn-sync-${randomUUID()}.db`);
		databaseUrl = `file:${tmpDb}`;
		await runMigrationsOnTestDb(databaseUrl);
		prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
		repository = new IdentityRepository(prisma as unknown as PrismaService);
		const connection = await createTestApiConnection(prisma);
		connectionId = connection.id;
	});

	afterAll(async () => {
		await prisma.$disconnect();
		try {
			unlinkSync(databaseUrl.replace(/^file:/, ''));
		} catch {
			// ignore
		}
	});

	const sampleUser = {
		externalId: 'ext-001',
		username: 'jdoe',
		email: 'JDOE@Example.COM',
		displayName: 'John Doe',
		passwordHash: TEST_PASSWORD_HASH,
		passwordHashAlgorithm: DEFAULT_PASSWORD_HASH_ALGORITHM,
		active: true,
	};

	it('API-SYNC-REPO-01: upsertUser creates then updates hash', async () => {
		const created = await repository.upsertUser(connectionId, sampleUser);
		expect(created.passwordHash).toBe(TEST_PASSWORD_HASH);

		const updated = await repository.upsertUser(connectionId, {
			...sampleUser,
			passwordHash: '$2b$12$updated.hash.value.here.xxxxxxxxxxxxxxxx',
		});
		expect(updated.passwordHash).toBe('$2b$12$updated.hash.value.here.xxxxxxxxxxxxxxxx');
		expect(updated.id).toBe(created.id);
	});

	it('API-SYNC-REPO-02: upsertUser respects active false from API', async () => {
		const row = await repository.upsertUser(connectionId, {
			...sampleUser,
			externalId: 'ext-inactive',
			username: 'inactive-user',
			active: false,
		});
		expect(row.active).toBe(false);
	});

	it('API-SYNC-REPO-03: replaceUserGroups replaces all links', async () => {
		const user = await repository.upsertUser(connectionId, {
			...sampleUser,
			externalId: 'ext-groups',
			username: 'groups-user',
		});
		const g1 = await repository.upsertGroup(connectionId, { id: 'grp-a', name: 'team-a' });
		const g2 = await repository.upsertGroup(connectionId, { id: 'grp-b', name: 'team-b' });
		await repository.replaceUserGroups(user.id, [g1.id]);
		expect(await prisma.userGroup.count({ where: { userId: user.id } })).toBe(1);
		await repository.replaceUserGroups(user.id, [g1.id, g2.id]);
		expect(await prisma.userGroup.count({ where: { userId: user.id } })).toBe(2);
		await repository.replaceUserGroups(user.id, []);
		expect(await prisma.userGroup.count({ where: { userId: user.id } })).toBe(0);
	});

	it('API-SYNC-REPO-04: deactivateUsersNotInExternalIds soft-deactivates and clears joins', async () => {
		const user = await createTestUser(prisma, connectionId, {
			externalId: 'ext-remove',
			username: 'remove-me',
			active: true,
		});
		const group = await createTestGroup(prisma, connectionId, {
			externalId: 'grp-x',
			name: 'grp-x',
		});
		await prisma.userGroup.create({ data: { userId: user.id, groupId: group.id } });

		await repository.deactivateUsersNotInExternalIds(connectionId, new Set(['other-id']));

		const updated = await prisma.user.findUnique({ where: { id: user.id } });
		expect(updated?.active).toBe(false);
		expect(await prisma.userGroup.count({ where: { userId: user.id } })).toBe(0);
	});

	it('API-SYNC-REPO-05: deleteOrphanGroups removes unreferenced groups', async () => {
		await repository.upsertGroup(connectionId, { id: 'grp-keep', name: 'keep-group' });
		await repository.upsertGroup(connectionId, { id: 'grp-drop', name: 'drop-group' });
		await repository.deleteOrphanGroups(connectionId, new Set(['grp-keep']));
		const remaining = await prisma.group.findMany({ where: { apiConnectionId: connectionId } });
		expect(remaining.some((g) => g.externalId === 'grp-drop')).toBe(false);
		expect(remaining.some((g) => g.externalId === 'grp-keep')).toBe(true);
	});

	it('API-SYNC-REPO-06: username collision throws', async () => {
		await repository.upsertUser(connectionId, {
			...sampleUser,
			externalId: 'ext-u1',
			username: 'collision-user',
		});
		await expect(
			repository.upsertUser(connectionId, {
				...sampleUser,
				externalId: 'ext-u2',
				username: 'collision-user',
			}),
		).rejects.toBeInstanceOf(UsernameCollisionError);
	});

	it('API-SYNC-REPO-07: group name unique violation handled', async () => {
		await repository.upsertGroup(connectionId, { id: 'grp-n1', name: 'duplicate-name' });
		await expect(
			repository.upsertGroup(connectionId, { id: 'grp-n2', name: 'duplicate-name' }),
		).rejects.toBeInstanceOf(GroupNameCollisionError);
	});

	it('API-SYNC-REPO-08: upsertUser stores normalized lowercase email', async () => {
		const row = await repository.upsertUser(connectionId, {
			...sampleUser,
			externalId: 'ext-email',
			username: 'email-user',
			email: 'MixedCase@EXAMPLE.com',
		});
		expect(row.email).toBe('mixedcase@example.com');
	});

	it('API-SYNC-REPO-09: replaceUserRoles replaces all links', async () => {
		const user = await repository.upsertUser(connectionId, {
			...sampleUser,
			externalId: 'ext-roles',
			username: 'roles-user',
		});
		const r1 = await repository.upsertRole(connectionId, { id: 'role-a', name: 'role-a' });
		const r2 = await repository.upsertRole(connectionId, { id: 'role-b', name: 'role-b' });
		await repository.replaceUserRoles(user.id, [r1.id]);
		expect(await prisma.userRole.count({ where: { userId: user.id } })).toBe(1);
		await repository.replaceUserRoles(user.id, [r1.id, r2.id]);
		expect(await prisma.userRole.count({ where: { userId: user.id } })).toBe(2);
		await repository.replaceUserRoles(user.id, []);
		expect(await prisma.userRole.count({ where: { userId: user.id } })).toBe(0);
	});

	it('API-SYNC-REPO-10: deleteOrphanRoles removes unreferenced roles', async () => {
		await repository.upsertRole(connectionId, { id: 'role-keep', name: 'keep-role' });
		await repository.upsertRole(connectionId, { id: 'role-drop', name: 'drop-role' });
		await repository.deleteOrphanRoles(connectionId, new Set(['role-keep']));
		const remaining = await prisma.role.findMany({ where: { apiConnectionId: connectionId } });
		expect(remaining.some((r) => r.externalId === 'role-drop')).toBe(false);
		expect(remaining.some((r) => r.externalId === 'role-keep')).toBe(true);
	});

	it('API-SYNC-REPO-11: role name unique violation handled', async () => {
		await repository.upsertRole(connectionId, { id: 'role-n1', name: 'duplicate-role' });
		await expect(
			repository.upsertRole(connectionId, { id: 'role-n2', name: 'duplicate-role' }),
		).rejects.toBeInstanceOf(RoleNameCollisionError);
	});

	it('API-SYNC-REPO-12: upsertUser reactivates previously deactivated user', async () => {
		const first = await repository.upsertUser(connectionId, {
			...sampleUser,
			externalId: 'ext-reactivate',
			username: 'reactivate-user',
			active: true,
		});
		await repository.deactivateUsersNotInExternalIds(connectionId, new Set(['other']));
		const reactivated = await repository.upsertUser(connectionId, {
			...sampleUser,
			externalId: 'ext-reactivate',
			username: 'reactivate-user',
			active: true,
		});
		expect(reactivated.id).toBe(first.id);
		expect(reactivated.active).toBe(true);
	});

	it('API-SYNC-REPO-13: upsertUser with active:false stores inactive row', async () => {
		const row = await repository.upsertUser(connectionId, {
			...sampleUser,
			externalId: 'ext-inactive',
			username: 'inactive-user',
			active: false,
		});
		expect(row.active).toBe(false);
	});

	it('API-SYNC-REPO-14: deactivateUsersNotInExternalIds clears user roles', async () => {
		const user = await createTestUser(prisma, connectionId, {
			externalId: 'ext-role-clear',
			username: 'role-clear',
			active: true,
		});
		const role = await createTestRole(prisma, connectionId, {
			externalId: 'role-x',
			name: 'role-x',
		});
		await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

		await repository.deactivateUsersNotInExternalIds(connectionId, new Set(['other-id']));

		expect(await prisma.userRole.count({ where: { userId: user.id } })).toBe(0);
	});
});
