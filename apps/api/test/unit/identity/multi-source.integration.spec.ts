import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IdentityOrigin } from '@prisma/client';
import {
	IdentityRepository,
	MembershipCrossConnectionError,
	UsernameCollisionError,
} from '@api/identity/identity.repository';
import { PrismaService } from '@api/prisma/services/prisma.service';
import { createTestApiConnection, createTestGroup } from '@test/support/prisma/test-fixtures';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';

jest.setTimeout(30_000);

/**
 * Multiple API connections for sync — store-level invariants (Prompt 37): per-record source tag,
 * cross-connection username collision, separate records, membership-within-source, per-source counts,
 * and source-identity removal. Real IdentityRepository against a fresh SQLite DB.
 */
describe('IdentityRepository multi-source (local libSQL)', () => {
	let dbPath: string;
	let prisma: PrismaService;
	let repo: IdentityRepository;
	let connA: string;
	let connB: string;

	const upsert = (connId: string, externalId: string, username: string) =>
		repo.upsertUser(connId, {
			externalId,
			username,
			email: null,
			displayName: null,
			passwordHash: '$2b$12$test.hash.for.integration.tests.only',
			passwordHashAlgorithm: 'bcrypt',
			active: true,
		});

	beforeEach(async () => {
		dbPath = join(tmpdir(), `nestidp-mas-${randomUUID()}.db`);
		await runMigrationsOnTestDb(`file:${dbPath}`);
		prisma = new PrismaService({ url: `file:${dbPath}` });
		repo = new IdentityRepository(prisma);
		connA = (await createTestApiConnection(prisma, { name: 'A' })).id;
		connB = (await createTestApiConnection(prisma, { name: 'B' })).id;
	});

	afterEach(async () => {
		await prisma.$disconnect();
		if (existsSync(dbPath)) {
			rmSync(dbPath, { force: true });
		}
	});

	it('MAS-TAG-01: a synced user is tagged with its source apiConnectionId', async () => {
		const u = await upsert(connA, 'ext-1', 'alice');
		const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
		expect(row.apiConnectionId).toBe(connA);
		expect(row.origin).toBe(IdentityOrigin.SYNCED);
	});

	it('MAS-SEP-01: the same externalId in two sources yields two separate rows', async () => {
		const a = await upsert(connA, 'shared-ext', 'alice');
		const b = await upsert(connB, 'shared-ext', 'bob');
		expect(a.id).not.toBe(b.id);
		expect(await prisma.user.count()).toBe(2);
	});

	it('MAS-SEP-02: the same group name in two sources are two separate records', async () => {
		const g1 = await createTestGroup(prisma, connA, { name: 'Engineering' });
		const g2 = await createTestGroup(prisma, connB, { name: 'Engineering' });
		expect(g1.id).not.toBe(g2.id);
	});

	it('MAS-COLL-01: a cross-connection username collision throws (owner is kept)', async () => {
		await upsert(connA, 'ext-a', 'alice');
		await expect(upsert(connB, 'ext-b', 'alice')).rejects.toBeInstanceOf(UsernameCollisionError);
		// the original owner is untouched and exactly one "alice" persists
		const alices = await prisma.user.findMany({ where: { username: 'alice' } });
		expect(alices).toHaveLength(1);
		expect(alices[0].apiConnectionId).toBe(connA);
	});

	it('MAS-COLL-02: re-syncing the same (connection, externalId) updates, no collision', async () => {
		const first = await upsert(connA, 'ext-a', 'alice');
		const second = await upsert(connA, 'ext-a', 'alice');
		expect(second.id).toBe(first.id);
	});

	it('MAS-MEM-01: a user can only be a member of its own source groups', async () => {
		const u = await upsert(connA, 'ext-a', 'alice');
		const ownGroup = await createTestGroup(prisma, connA, { name: 'A-grp' });
		const foreignGroup = await createTestGroup(prisma, connB, { name: 'B-grp' });
		await repo.replaceUserGroups(u.id, [ownGroup.id]); // ok
		await expect(repo.replaceUserGroups(u.id, [foreignGroup.id])).rejects.toBeInstanceOf(
			MembershipCrossConnectionError,
		);
	});

	it('MAS-COUNT-01: countsByConnection reports per-source counts', async () => {
		await upsert(connA, 'a1', 'a1');
		await upsert(connA, 'a2', 'a2');
		await upsert(connB, 'b1', 'b1');
		await createTestGroup(prisma, connA, { name: 'g' });
		const counts = await repo.countsByConnection();
		expect(counts.users[connA]).toBe(2);
		expect(counts.users[connB]).toBe(1);
		expect(counts.groups[connA]).toBe(1);
	});

	it('MAS-DEL-01: removeConnectionIdentities(deactivate) disables only that source, terminates nothing locally', async () => {
		await upsert(connA, 'a1', 'a1');
		await upsert(connB, 'b1', 'b1');
		const ids = await repo.syncedUserIdsForConnection(connA);
		expect(ids).toHaveLength(1);
		const res = await repo.removeConnectionIdentities(connA, 'deactivate');
		expect(res.usersRemoved).toBe(1);
		expect((await prisma.user.findFirstOrThrow({ where: { apiConnectionId: connA } })).active).toBe(
			false,
		);
		// source B untouched
		expect((await prisma.user.findFirstOrThrow({ where: { apiConnectionId: connB } })).active).toBe(
			true,
		);
	});

	it('MAS-DEL-02: removeConnectionIdentities(delete) removes only that source rows', async () => {
		await upsert(connA, 'a1', 'a1');
		await createTestGroup(prisma, connA, { name: 'g' });
		await upsert(connB, 'b1', 'b1');
		const res = await repo.removeConnectionIdentities(connA, 'delete');
		expect(res.usersRemoved).toBe(1);
		expect(res.groupsRemoved).toBe(1);
		expect(await prisma.user.count({ where: { apiConnectionId: connA } })).toBe(0);
		expect(await prisma.user.count({ where: { apiConnectionId: connB } })).toBe(1);
	});
});
