import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
	createTestApiConnection,
	createTestGroup,
	createTestRole,
	createTestUser,
} from '../prisma/test-fixtures';
import { runMigrationsOnTestDb } from '../prisma/test-db.helper';
import { IdentityRepository } from './identity.repository';

jest.setTimeout(60_000);

describe('IdentityRepository auth lookups (SQLite)', () => {
	let prisma: PrismaClient;
	let repository: IdentityRepository;
	let databaseUrl: string;
	let connectionId: string;

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-idn-auth-${randomUUID()}.db`);
		databaseUrl = `file:${tmpDb}`;
		runMigrationsOnTestDb(databaseUrl, 'sqlite');
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

	it('API-AUTH-REPO-01: findUserByUsername returns user row', async () => {
		await createTestUser(prisma, connectionId, { username: 'repo-alice' });
		const user = await repository.findUserByUsername('repo-alice');
		expect(user?.username).toBe('repo-alice');
	});

	it('API-AUTH-REPO-02: findUserByUsername returns null for unknown', async () => {
		expect(await repository.findUserByUsername('missing-user')).toBeNull();
	});

	it('API-AUTH-REPO-03: findUserProfileById includes sorted group and role names', async () => {
		const user = await createTestUser(prisma, connectionId, { username: 'repo-profile' });
		const group = await createTestGroup(prisma, connectionId, { name: 'Zeta' });
		const role = await createTestRole(prisma, connectionId, { name: 'Admin' });
		await prisma.userGroup.create({ data: { userId: user.id, groupId: group.id } });
		await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

		const profile = await repository.findUserProfileById(user.id);
		expect(profile?.groups).toEqual(['Zeta']);
		expect(profile?.roles).toEqual(['Admin']);
	});

	it('API-AUTH-REPO-04: findUserProfileById returns inactive users for guard rejection upstream', async () => {
		const user = await createTestUser(prisma, connectionId, {
			username: 'repo-inactive',
			active: false,
		});
		const profile = await repository.findUserProfileById(user.id);
		expect(profile?.active).toBe(false);
	});

	it('API-AUTH-REPO-06: findUserByUsername is case-sensitive', async () => {
		await createTestUser(prisma, connectionId, { username: 'ExactCase' });
		expect(await repository.findUserByUsername('exactcase')).toBeNull();
		expect(await repository.findUserByUsername('ExactCase')).not.toBeNull();
	});

	it('API-AUTH-REPO-05: findUserProfileById returns null after delete', async () => {
		const user = await createTestUser(prisma, connectionId, { username: 'repo-deleted' });
		await prisma.user.delete({ where: { id: user.id } });
		expect(await repository.findUserProfileById(user.id)).toBeNull();
	});
});
