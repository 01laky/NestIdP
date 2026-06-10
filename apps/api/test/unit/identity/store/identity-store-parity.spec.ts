import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IdentityOrigin } from '@prisma/client';
import { DEFAULT_PASSWORD_HASH_ALGORITHM } from '@nestidp/shared';
import { PrismaService } from '@api/prisma/services/prisma.service';
import { IdentityRepository } from '@api/identity/identity.repository';
import {
	MembershipCrossConnectionError,
	UsernameCollisionError,
} from '@api/identity/store/identity-store-errors';
import type { IdentityStore } from '@api/identity/store/identity-store';
import { createTestApiConnection } from '@test/support/prisma/test-fixtures';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';
import { createPgliteStore } from '@test/support/identity/pglite-store';

jest.setTimeout(60_000);

/**
 * One scenario matrix run against BOTH identity stores — the local libSQL `IdentityRepository` and the
 * external PGlite `SqlIdentityStore` (Prompt 38 §A18). This is the parity guard: a behaviour that holds on
 * one store but not the other (search case/wildcards, source-removal cascade, collision/cross-source
 * invariants) fails here for the divergent store.
 */
interface ParityHandle {
	store: IdentityStore;
	/** A usable api_connection_id (a seeded ApiConnection row locally; any string externally — no FK). */
	makeConn(): Promise<string>;
	destroy(): Promise<void>;
}

async function localHandle(): Promise<ParityHandle> {
	const url = `file:${join(tmpdir(), `parity-local-${randomUUID()}.db`)}`;
	await runMigrationsOnTestDb(url);
	const prisma = new PrismaService({ datasources: { db: { url } } });
	return {
		store: new IdentityRepository(prisma as never),
		makeConn: async () => (await createTestApiConnection(prisma)).id,
		destroy: async () => {
			await prisma.$disconnect();
			try {
				unlinkSync(url.replace(/^file:/, ''));
			} catch {
				// best-effort cleanup
			}
		},
	};
}

async function externalHandle(): Promise<ParityHandle> {
	const handle = await createPgliteStore();
	let n = 0;
	return {
		store: handle.store,
		makeConn: async () => `conn-${++n}`,
		destroy: () => handle.destroy(),
	};
}

function user(over: { externalId: string; username: string; email?: string | null }) {
	return {
		externalId: over.externalId,
		username: over.username,
		email: over.email ?? `${over.username}@example.com`,
		displayName: over.username,
		passwordHash: '$2b$12$hashhashhashhashhashhash',
		passwordHashAlgorithm: DEFAULT_PASSWORD_HASH_ALGORITHM,
		active: true,
	};
}

describe.each([
	['local (libSQL)', localHandle],
	['external (PGlite)', externalHandle],
])('IdentityStore parity — %s', (_name, factory) => {
	let h: ParityHandle;
	let store: IdentityStore;
	let conn: string;

	beforeEach(async () => {
		h = await factory();
		store = h.store;
		conn = await h.makeConn();
	});
	afterEach(async () => {
		await h.destroy();
	});

	it('PARITY-SEARCH-CI: username search is case-insensitive (ASCII)', async () => {
		await store.upsertUser(conn, user({ externalId: 'e1', username: 'AliceSmith' }));
		const res = await store.listUsers({ limit: 10, offset: 0, search: 'alicesmith' });
		expect(res.items.map((u) => u.username)).toEqual(['AliceSmith']);
	});

	it('PARITY-SEARCH-WILDCARD: LIKE wildcards in the term match literally', async () => {
		await store.upsertUser(conn, user({ externalId: 'e1', username: 'a%b', email: 'a@x.com' }));
		await store.upsertUser(conn, user({ externalId: 'e2', username: 'axxb', email: 'b@x.com' }));
		const res = await store.listUsers({ limit: 10, offset: 0, search: 'a%b' });
		expect(res.items.map((u) => u.username)).toEqual(['a%b']);
	});

	it('PARITY-REMOVE-DELETE: removing a source deletes its rows and cascades memberships', async () => {
		const u = await store.upsertUser(conn, user({ externalId: 'e1', username: 'u1' }));
		const g = await store.upsertGroup(conn, { id: 'g-ext-1', name: 'Engineering' });
		await store.replaceUserGroups(u.id, [g.id]);

		const removed = await store.removeConnectionIdentities(conn, 'delete');
		expect(removed.usersRemoved).toBe(1);
		expect(removed.groupsRemoved).toBe(1);
		expect(await store.countUsers()).toBe(0);
		expect(await store.countGroups()).toBe(0);
		// No dangling membership row remained (the delete cascaded).
		expect(await store.getUserById(u.id)).toBeNull();
	});

	it('PARITY-REMOVE-DEACTIVATE: deactivate disables the source users but keeps the rows', async () => {
		const u = await store.upsertUser(conn, user({ externalId: 'e1', username: 'u1' }));
		const removed = await store.removeConnectionIdentities(conn, 'deactivate');
		expect(removed.usersRemoved).toBe(1);
		expect(await store.countUsers()).toBe(1);
		expect((await store.getUserById(u.id))?.active).toBe(false);
	});

	it('PARITY-COLLISION: a username already used by another source is rejected', async () => {
		const other = await h.makeConn();
		await store.upsertUser(conn, user({ externalId: 'e1', username: 'dup' }));
		await expect(
			store.upsertUser(other, user({ externalId: 'e2', username: 'dup' })),
		).rejects.toBeInstanceOf(UsernameCollisionError);
	});

	it('PARITY-MEMBERSHIP-CROSS: a user cannot be assigned a group from another source', async () => {
		const other = await h.makeConn();
		const u = await store.upsertUser(conn, user({ externalId: 'e1', username: 'u1' }));
		const foreign = await store.upsertGroup(other, { id: 'g-ext-9', name: 'Foreign' });
		await expect(store.replaceUserGroups(u.id, [foreign.id])).rejects.toBeInstanceOf(
			MembershipCrossConnectionError,
		);
	});

	it('PARITY-MANUAL-ORIGIN: a manually-created group reports MANUAL origin and counts members', async () => {
		const g = await store.createManualGroup(conn, 'Manual Team');
		expect(g.origin).toBe(IdentityOrigin.MANUAL);
		expect(await store.groupMemberCount(g.id)).toBe(0);
	});

	it('PARITY-UPSERT-RETURN: upserts return the full row on insert AND update (§5.C)', async () => {
		const inserted = await store.upsertUser(conn, user({ externalId: 'e1', username: 'u1' }));
		expect(inserted).toMatchObject({
			externalId: 'e1',
			apiConnectionId: conn,
			origin: IdentityOrigin.SYNCED,
			username: 'u1',
			email: 'u1@example.com',
			active: true,
		});
		expect(inserted.createdAt).toBeInstanceOf(Date);
		expect(inserted.updatedAt).toBeInstanceOf(Date);

		const updated = await store.upsertUser(
			conn,
			user({ externalId: 'e1', username: 'u1-renamed' }),
		);
		expect(updated.id).toBe(inserted.id);
		expect(updated.username).toBe('u1-renamed');
		// createdAt on the update path must match what a subsequent read returns (preserved, not reset)
		const reread = await store.getUserById(inserted.id);
		expect(updated.createdAt.getTime()).toBe(reread?.createdAt.getTime());

		const g1 = await store.upsertGroup(conn, { id: 'g-ext-1', name: 'Engineering' });
		expect(g1).toMatchObject({
			externalId: 'g-ext-1',
			apiConnectionId: conn,
			origin: IdentityOrigin.SYNCED,
			name: 'Engineering',
		});
		const g2 = await store.upsertGroup(conn, { id: 'g-ext-1', name: 'Renamed' });
		expect(g2.id).toBe(g1.id);
		expect(g2.name).toBe('Renamed');

		const r1 = await store.upsertRole(conn, { id: 'r-ext-1', name: 'admin' });
		expect(r1).toMatchObject({
			externalId: 'r-ext-1',
			apiConnectionId: conn,
			origin: IdentityOrigin.SYNCED,
			name: 'admin',
		});
	});
});
