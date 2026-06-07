import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IdentityOrigin } from '@prisma/client';
import { IdentityRepository } from '@api/identity/identity.repository';
import { PrismaService } from '@api/prisma/services/prisma.service';
import {
	createTestApiConnection,
	createTestGroup,
	createTestRole,
	createTestUser,
} from '@test/support/prisma/test-fixtures';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';

jest.setTimeout(30_000);

describe('IdentityRepository replication (local libSQL)', () => {
	let dbPath: string;
	let prisma: PrismaService;
	let repo: IdentityRepository;
	let connId: string;
	let userId: string;

	beforeEach(async () => {
		dbPath = join(tmpdir(), `nestidp-repl-${randomUUID()}.db`);
		await runMigrationsOnTestDb(`file:${dbPath}`);
		prisma = new PrismaService({ url: `file:${dbPath}` });
		repo = new IdentityRepository(prisma);
		const conn = await createTestApiConnection(prisma);
		connId = conn.id;
		const u = await createTestUser(prisma, connId, { username: 'alice' });
		userId = u.id;
		const g = await createTestGroup(prisma, connId, { name: 'Eng' });
		const r = await createTestRole(prisma, connId, {
			name: 'admin',
			origin: IdentityOrigin.MANUAL,
		});
		await repo.replaceUserGroups(u.id, [g.id]);
		await repo.replaceUserRoles(u.id, [r.id]);
	});

	afterEach(async () => {
		await prisma.$disconnect();
		for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
			if (existsSync(f)) rmSync(f, { force: true });
		}
	});

	it('REPL-01: exportAll captures users/groups/roles + memberships', async () => {
		const snap = await repo.exportAll();
		expect(snap.users).toHaveLength(1);
		expect(snap.groups).toHaveLength(1);
		expect(snap.roles).toHaveLength(1);
		expect(snap.userGroups).toHaveLength(1);
		expect(snap.userRoles).toHaveLength(1);
		expect(snap.roles[0].origin).toBe(IdentityOrigin.MANUAL);
	});

	it('REPL-02: wipeAll → importSnapshot restores an exact copy (ids, origin, memberships)', async () => {
		const snap = await repo.exportAll();
		await repo.wipeAll();
		expect(await repo.countUsers()).toBe(0);
		expect(await repo.countGroups()).toBe(0);

		const counts = await repo.importSnapshot(snap, 'upsert');
		expect(counts.usersInserted).toBe(1);
		expect(counts.groupsInserted).toBe(1);
		expect(counts.rolesInserted).toBe(1);

		const restored = await repo.getUserWithMemberships(userId);
		expect(restored?.user.username).toBe('alice');
		expect(restored?.groups.map((g) => g.name)).toEqual(['Eng']);
		expect(restored?.roles.map((r) => r.name)).toEqual(['admin']);
		expect(restored?.roles[0].origin).toBe(IdentityOrigin.MANUAL);
	});

	it('REPL-03: importSnapshot insert-missing does not overwrite existing rows', async () => {
		const snap = await repo.exportAll();
		snap.users[0] = { ...snap.users[0], displayName: 'CHANGED' };
		const counts = await repo.importSnapshot(snap, 'insert-missing');
		expect(counts.usersInserted).toBe(0);
		expect(counts.usersUpdated).toBe(0);
		expect((await repo.getUserById(userId))?.displayName).not.toBe('CHANGED');
	});

	it('REPL-04: importSnapshot reports progress ending at total', async () => {
		const snap = await repo.exportAll();
		await repo.wipeAll();
		const progress: Array<[number, number]> = [];
		await repo.importSnapshot(snap, 'upsert', (done, total) => progress.push([done, total]));
		const total = snap.users.length + snap.groups.length + snap.roles.length;
		expect(progress[progress.length - 1]).toEqual([total, total]);
	});

	it('REPL-05: connectionHasIdentityRows reflects the local store', async () => {
		expect(await repo.connectionHasIdentityRows(connId)).toBe(true);
		await repo.wipeAll();
		expect(await repo.connectionHasIdentityRows(connId)).toBe(false);
	});
});
