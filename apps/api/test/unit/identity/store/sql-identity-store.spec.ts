import { IdentityOrigin } from '@prisma/client';
import {
	GroupNameCollisionError,
	MembershipCrossConnectionError,
	UsernameCollisionError,
} from '@api/identity/identity.repository';
import { sql } from 'kysely';
import {
	classifyOwnership,
	ensureSchema,
	getMetaValue,
	runExternalMigrations,
} from '@api/identity/store/external/external-schema';
import { SqlIdentityStore } from '@api/identity/store/external/sql-identity-store';
import {
	createPgliteKysely,
	createPgliteStore,
	type PgliteStoreHandle,
} from '@test/support/identity/pglite-store';

jest.setTimeout(30_000);

const CONN = 'conn-api-1';

function upsertInput(over: Partial<Parameters<SqlIdentityStore['upsertUser']>[1]> = {}) {
	return {
		externalId: 'ext-1',
		username: 'alice',
		email: 'alice@example.com',
		displayName: 'Alice',
		passwordHash: '$2b$12$hashhashhashhashhashhash',
		passwordHashAlgorithm: 'bcrypt',
		active: true,
		...over,
	};
}

describe('SqlIdentityStore (external, PGlite)', () => {
	let handle: PgliteStoreHandle;
	let store: SqlIdentityStore;

	beforeEach(async () => {
		handle = await createPgliteStore();
		store = handle.store;
	});
	afterEach(async () => {
		await handle.destroy();
	});

	it('EXT-SCHEMA-01: fresh DB is classified ours after ensureSchema and enforces username uniqueness', async () => {
		await expect(classifyOwnership(handle.db)).resolves.toBe('ours');
		await store.upsertUser(CONN, upsertInput());
		await expect(
			store.upsertUser('conn-api-2', upsertInput({ externalId: 'ext-2' })),
		).rejects.toBeInstanceOf(UsernameCollisionError);
	});

	it('STORE-USER-01: upsert inserts then updates by (conn, externalId); counts reflect it', async () => {
		const a = await store.upsertUser(CONN, upsertInput());
		expect(await store.countUsers()).toBe(1);
		const b = await store.upsertUser(CONN, upsertInput({ displayName: 'Alice B', active: false }));
		expect(b.id).toBe(a.id);
		expect(await store.countUsers()).toBe(1);
		const row = await store.getUserById(a.id);
		expect(row?.displayName).toBe('Alice B');
		expect(row?.active).toBe(false);
	});

	it('STORE-USER-02: findUserByUsername returns the password hash for login', async () => {
		await store.upsertUser(CONN, upsertInput());
		const row = await store.findUserByUsername('alice');
		expect(row?.passwordHash).toBe('$2b$12$hashhashhashhashhashhash');
		expect(row?.active).toBe(true);
		await expect(store.findUserByUsername('nobody')).resolves.toBeNull();
	});

	it('STORE-MEMBERSHIP-01: replace groups/roles and read the SAML profile', async () => {
		const u = await store.upsertUser(CONN, upsertInput());
		const g1 = await store.upsertGroup(CONN, { id: 'g1', name: 'Engineering' });
		const g2 = await store.upsertGroup(CONN, { id: 'g2', name: 'Ops' });
		const r1 = await store.upsertRole(CONN, { id: 'r1', name: 'admin' });
		await store.replaceUserGroups(u.id, [g1.id, g2.id]);
		await store.replaceUserRoles(u.id, [r1.id]);
		const profile = await store.findUserProfileById(u.id);
		expect(profile?.groups.sort()).toEqual(['Engineering', 'Ops']);
		expect(profile?.roles).toEqual(['admin']);
		// replace is a full swap
		await store.replaceUserGroups(u.id, [g2.id]);
		expect((await store.findUserProfileById(u.id))?.groups).toEqual(['Ops']);
	});

	it('STORE-GROUP-01: upsertGroup name collision throws GroupNameCollisionError', async () => {
		await store.upsertGroup(CONN, { id: 'g1', name: 'Dup' });
		await expect(store.upsertGroup(CONN, { id: 'g2', name: 'Dup' })).rejects.toBeInstanceOf(
			GroupNameCollisionError,
		);
	});

	it('STORE-ORPHAN-01: deactivate + delete-orphans by external id set', async () => {
		const u1 = await store.upsertUser(CONN, upsertInput({ externalId: 'e1', username: 'u1' }));
		await store.upsertUser(CONN, upsertInput({ externalId: 'e2', username: 'u2' }));
		await store.upsertGroup(CONN, { id: 'g1', name: 'G1' });
		await store.upsertGroup(CONN, { id: 'g2', name: 'G2' });

		const deactivated = await store.deactivateUsersNotInExternalIds(CONN, new Set(['e1']));
		expect(deactivated).toBe(1);
		expect((await store.getUserById(u1.id))?.active).toBe(true);

		const removed = await store.deleteOrphanGroups(CONN, new Set(['g1']));
		expect(removed).toBe(1);
		expect(await store.countGroups()).toBe(1);
	});

	it('STORE-ADMIN-USERS-01: paginated list with search + origin filter', async () => {
		await store.upsertUser(
			CONN,
			upsertInput({ externalId: 'e1', username: 'alice', email: 'a@x' }),
		);
		await store.upsertUser(CONN, upsertInput({ externalId: 'e2', username: 'bob', email: 'b@x' }));
		await store.createManualUser({
			apiConnectionId: CONN,
			username: 'carol',
			email: null,
			displayName: null,
			passwordHash: 'h',
			passwordHashAlgorithm: 'bcrypt',
			active: true,
			groupIds: [],
			roleIds: [],
		});

		const all = await store.listUsers({ limit: 50, offset: 0 });
		expect(all.total).toBe(3);
		expect(all.items.map((u) => u.username)).toEqual(['alice', 'bob', 'carol']);

		const search = await store.listUsers({ limit: 50, offset: 0, search: 'ALI' });
		expect(search.items.map((u) => u.username)).toEqual(['alice']);

		const manual = await store.listUsers({ limit: 50, offset: 0, origin: IdentityOrigin.MANUAL });
		expect(manual.items.map((u) => u.username)).toEqual(['carol']);

		const page = await store.listUsers({ limit: 1, offset: 1 });
		expect(page.items.map((u) => u.username)).toEqual(['bob']);
		expect(page.total).toBe(3);
	});

	it('STORE-ADMIN-USERS-02: create/update manual user with memberships, get-with-memberships, delete', async () => {
		const g = await store.upsertGroup(CONN, { id: 'g1', name: 'Eng' });
		const r = await store.upsertRole(CONN, { id: 'r1', name: 'admin' });
		const created = await store.createManualUser({
			apiConnectionId: CONN,
			username: 'dave',
			email: 'dave@x',
			displayName: 'Dave',
			passwordHash: 'h',
			passwordHashAlgorithm: 'bcrypt',
			active: true,
			groupIds: [g.id],
			roleIds: [r.id],
		});
		expect(created.origin).toBe(IdentityOrigin.MANUAL);
		expect(created.externalId).toBe(`manual:user:${created.id}`);

		const detail = await store.getUserWithMemberships(created.id);
		expect(detail?.groups.map((x) => x.name)).toEqual(['Eng']);
		expect(detail?.roles.map((x) => x.name)).toEqual(['admin']);

		await store.updateManualUser(created.id, { displayName: 'Dave!', groupIds: [], active: false });
		const after = await store.getUserWithMemberships(created.id);
		expect(after?.user.displayName).toBe('Dave!');
		expect(after?.user.active).toBe(false);
		expect(after?.groups).toEqual([]);
		expect(after?.roles.map((x) => x.name)).toEqual(['admin']);

		await store.deleteUser(created.id);
		expect(await store.getUserById(created.id)).toBeNull();
	});

	it('STORE-ADMIN-USERS-03: isUsernameTaken + membership validation', async () => {
		const u = await store.upsertUser(CONN, upsertInput());
		expect(await store.isUsernameTaken('alice')).toBe(true);
		expect(await store.isUsernameTaken('alice', u.id)).toBe(false);
		expect(await store.isUsernameTaken('nobody')).toBe(false);

		const g = await store.upsertGroup(CONN, { id: 'g1', name: 'G' });
		expect(await store.groupsExistAll([g.id])).toBe(true);
		expect(await store.groupsExistAll([g.id, 'missing'])).toBe(false);
		expect(await store.rolesExistAll([])).toBe(true);
	});

	it('STORE-ADMIN-GROUPS-01: list groups with member counts + members + name guard + delete', async () => {
		const g = await store.createManualGroup(CONN, 'Team');
		const u1 = await store.upsertUser(CONN, upsertInput({ externalId: 'e1', username: 'u1' }));
		const u2 = await store.upsertUser(CONN, upsertInput({ externalId: 'e2', username: 'u2' }));
		await store.replaceUserGroups(u1.id, [g.id]);
		await store.replaceUserGroups(u2.id, [g.id]);

		const list = await store.listGroups({ limit: 50, offset: 0 });
		expect(list.total).toBe(1);
		expect(list.items[0].memberCount).toBe(2);

		expect(await store.groupMemberCount(g.id)).toBe(2);
		const members = await store.getGroupMembers(g.id, 50);
		expect(members.map((m) => m.username)).toEqual(['u1', 'u2']);

		expect(await store.isGroupNameTaken(CONN, 'Team')).toBe(true);
		await store.updateGroupName(g.id, 'Team2');
		expect((await store.getGroupById(g.id))?.name).toBe('Team2');

		// delete after removing members
		await store.replaceUserGroups(u1.id, []);
		await store.replaceUserGroups(u2.id, []);
		await store.deleteGroup(g.id);
		expect(await store.getGroupById(g.id)).toBeNull();
	});

	it('STORE-ADMIN-ROLES-01: roles mirror group behavior', async () => {
		const role = await store.createManualRole(CONN, 'Viewer');
		expect(role.externalId).toBe(`manual:role:${role.id}`);
		const u = await store.upsertUser(CONN, upsertInput());
		await store.replaceUserRoles(u.id, [role.id]);
		expect(await store.roleMemberCount(role.id)).toBe(1);
		const list = await store.listRoles({ limit: 50, offset: 0 });
		expect(list.items[0].memberCount).toBe(1);
		expect(await store.isRoleNameTaken(CONN, 'Viewer')).toBe(true);
	});

	it('STORE-IMPORT-01: importSnapshot reports progress and ends at total', async () => {
		const u1 = await store.upsertUser(CONN, upsertInput({ externalId: 'e1', username: 'src-a' }));
		await store.upsertUser(CONN, upsertInput({ externalId: 'e2', username: 'src-b' }));
		const g = await store.upsertGroup(CONN, { id: 'g1', name: 'SrcGroup' });
		await store.replaceUserGroups(u1.id, [g.id]);
		const snapshot = await store.exportAll();

		const target = await createPgliteStore();
		try {
			const progress: Array<[number, number]> = [];
			const counts = await target.store.importSnapshot(snapshot, 'upsert', (done, total) =>
				progress.push([done, total]),
			);
			expect(counts.usersInserted).toBe(2);
			expect(counts.groupsInserted).toBe(1);
			// progress fires at least once and the last tick reaches total = users+groups+roles
			expect(progress.length).toBeGreaterThan(0);
			const total = snapshot.users.length + snapshot.groups.length + snapshot.roles.length;
			expect(progress[progress.length - 1]).toEqual([total, total]);
			// the copy is faithful (ids + membership preserved)
			expect(await target.store.countUsers()).toBe(2);
			expect((await target.store.findUserProfileById(u1.id))?.groups).toEqual(['SrcGroup']);
		} finally {
			await target.destroy();
		}
	});

	it('STORE-USER-03: upsertUser onto a MANUAL row is rejected as a collision', async () => {
		const manual = await store.createManualUser({
			apiConnectionId: CONN,
			username: 'manualu',
			email: null,
			displayName: null,
			passwordHash: 'h',
			passwordHashAlgorithm: 'bcrypt',
			active: true,
			groupIds: [],
			roleIds: [],
		});
		// a sync upsert targeting the same (conn, externalId) of a MANUAL row must not overwrite it
		await expect(
			store.upsertUser(CONN, upsertInput({ externalId: manual.externalId, username: 'sync-name' })),
		).rejects.toBeInstanceOf(UsernameCollisionError);
	});

	it('STORE-WIPE-01: wipeAll removes all identity rows', async () => {
		const u = await store.upsertUser(CONN, upsertInput());
		const g = await store.upsertGroup(CONN, { id: 'g1', name: 'G' });
		await store.replaceUserGroups(u.id, [g.id]);
		await store.upsertRole(CONN, { id: 'r1', name: 'R' });
		await store.wipeAll();
		expect(await store.countUsers()).toBe(0);
		expect(await store.countGroups()).toBe(0);
		expect(await store.countRoles()).toBe(0);
	});

	it('STORE-GUARD-01: connectionHasIdentityRows reflects whether a connection has rows', async () => {
		expect(await store.connectionHasIdentityRows(CONN)).toBe(false);
		await store.upsertGroup(CONN, { id: 'g1', name: 'G' });
		expect(await store.connectionHasIdentityRows(CONN)).toBe(true);
		expect(await store.connectionHasIdentityRows('other-conn')).toBe(false);
	});

	it('STORE-IMPORT-02: insert-missing mode never updates existing rows', async () => {
		await store.upsertUser(
			CONN,
			upsertInput({ externalId: 'e1', username: 'alice', displayName: 'Old' }),
		);
		const snapshot = await store.exportAll();
		snapshot.users[0] = { ...snapshot.users[0], displayName: 'NEW' };
		const counts = await store.importSnapshot(snapshot, 'insert-missing');
		expect(counts.usersUpdated).toBe(0);
		expect((await store.getUserById(snapshot.users[0].id))?.displayName).toBe('Old');
	});

	it('STORE-ORPHAN-02: empty external-id set deactivates / deletes all synced rows', async () => {
		const u = await store.upsertUser(CONN, upsertInput({ externalId: 'e1', username: 'u1' }));
		await store.upsertGroup(CONN, { id: 'g1', name: 'G1' });
		expect(await store.deactivateUsersNotInExternalIds(CONN, new Set())).toBe(1);
		expect((await store.getUserById(u.id))?.active).toBe(false);
		expect(await store.deleteOrphanGroups(CONN, new Set())).toBe(1);
		expect(await store.countGroups()).toBe(0);
	});

	it('EXT-SCHEMA-02: runExternalMigrations is idempotent and stamps the schema version', async () => {
		expect(await getMetaValue(handle.db, 'schema_version')).toBe('1');
		await expect(runExternalMigrations(handle.db, 'postgres')).resolves.toBe(1);
		// running again does not error or change the version
		await expect(runExternalMigrations(handle.db, 'postgres')).resolves.toBe(1);
		expect(await getMetaValue(handle.db, 'schema_version')).toBe('1');
	});

	it('EXT-OWN-01: empty database is "empty"; foreign tables are not classified as ours', async () => {
		const fresh = await createPgliteKysely();
		try {
			await expect(classifyOwnership(fresh)).resolves.toBe('empty');
			await fresh.schema.createTable('nestidp_user').addColumn('id', 'varchar(255)').execute();
			await expect(classifyOwnership(fresh)).resolves.toBe('foreign');
		} finally {
			await fresh.destroy();
		}
	});

	it('EXT-PGSCHEMA-01: pgSchema places all tables in the configured schema and round-trips (§B6)', async () => {
		const h = await createPgliteStore({ pgSchema: 'idp_test' });
		try {
			const tables = await sql<{ table_schema: string; table_name: string }>`
				select table_schema, table_name from information_schema.tables
				where table_name like 'nestidp_%'
			`.execute(h.db);
			expect(tables.rows.length).toBeGreaterThanOrEqual(6);
			expect(tables.rows.every((r) => r.table_schema === 'idp_test')).toBe(true);
			const u = await h.store.upsertUser(CONN, upsertInput());
			expect((await h.store.findUserByUsername('alice'))?.id).toBe(u.id);
			expect(await h.store.countUsers()).toBe(1);
		} finally {
			await h.destroy();
		}
	});

	it('EXT-SCHEMA-ATOMIC-01: a failed instance-marker write rolls back the whole init (§5.C)', async () => {
		let failMarker = true;
		const db = await createPgliteKysely({
			interceptQuery: (_sqlText, params) => {
				if (failMarker && params.includes('instance_id')) {
					throw new Error('marker write failed');
				}
			},
		});
		try {
			await expect(ensureSchema(db, 'postgres', 'inst-1')).rejects.toThrow('marker write failed');
			// rolled back as one unit: no half-init tables remain, so the DB is still 'empty', not 'foreign'
			const tables = await sql<{ table_name: string }>`
				select table_name from information_schema.tables where table_name like 'nestidp_%'
			`.execute(db);
			expect(tables.rows).toHaveLength(0);
			await expect(classifyOwnership(db)).resolves.toBe('empty');
			// recovery: the next attempt initializes cleanly and the DB becomes ours
			failMarker = false;
			await expect(ensureSchema(db, 'postgres', 'inst-1')).resolves.toEqual({
				ownership: 'empty',
				schemaVersion: 1,
			});
			await expect(classifyOwnership(db)).resolves.toBe('ours');
			expect(await getMetaValue(db, 'instance_id')).toBe('inst-1');
		} finally {
			await db.destroy();
		}
	});

	// --- Multiple API connections for sync — external store parity (Prompt 37) ---

	it('MAS-EXT-MEMBERSHIP: a user cannot be assigned a group from another connection', async () => {
		const u = await store.upsertUser(CONN, upsertInput());
		const own = await store.upsertGroup(CONN, { id: 'g-own', name: 'Own' });
		const foreign = await store.upsertGroup('conn-api-2', { id: 'g-foreign', name: 'Foreign' });
		await store.replaceUserGroups(u.id, [own.id]); // ok
		await expect(store.replaceUserGroups(u.id, [foreign.id])).rejects.toBeInstanceOf(
			MembershipCrossConnectionError,
		);
	});

	it('MAS-EXT-COUNTS: countsByConnection reports per-source counts', async () => {
		await store.upsertUser(CONN, upsertInput({ externalId: 'a1', username: 'a1' }));
		await store.upsertUser(CONN, upsertInput({ externalId: 'a2', username: 'a2' }));
		await store.upsertUser('conn-api-2', upsertInput({ externalId: 'b1', username: 'b1' }));
		await store.upsertGroup(CONN, { id: 'g1', name: 'g1' });
		const counts = await store.countsByConnection();
		expect(counts.users[CONN]).toBe(2);
		expect(counts.users['conn-api-2']).toBe(1);
		expect(counts.groups[CONN]).toBe(1);
	});

	it('MAS-EXT-REMOVE-DEACTIVATE: deactivates only the source’s users, leaves others active', async () => {
		const a = await store.upsertUser(CONN, upsertInput({ externalId: 'a1', username: 'a1' }));
		const b = await store.upsertUser(
			'conn-api-2',
			upsertInput({ externalId: 'b1', username: 'b1' }),
		);
		expect(await store.syncedUserIdsForConnection(CONN)).toEqual([a.id]);
		const res = await store.removeConnectionIdentities(CONN, 'deactivate');
		expect(res.usersRemoved).toBe(1);
		expect((await store.getUserById(a.id))?.active).toBe(false);
		expect((await store.getUserById(b.id))?.active).toBe(true);
	});

	it('MAS-EXT-REMOVE-DELETE: deletes only the source’s rows', async () => {
		await store.upsertUser(CONN, upsertInput({ externalId: 'a1', username: 'a1' }));
		await store.upsertGroup(CONN, { id: 'g1', name: 'g1' });
		await store.upsertUser('conn-api-2', upsertInput({ externalId: 'b1', username: 'b1' }));
		const res = await store.removeConnectionIdentities(CONN, 'delete');
		expect(res.usersRemoved).toBe(1);
		expect(res.groupsRemoved).toBe(1);
		expect(await store.countUsers()).toBe(1); // only conn-api-2's user remains
	});

	it('MAS-EXT-INCONN: groupsAllInConnection is true only for same-source groups', async () => {
		const own = await store.upsertGroup(CONN, { id: 'g-own', name: 'Own' });
		const foreign = await store.upsertGroup('conn-api-2', { id: 'g-foreign', name: 'Foreign' });
		expect(await store.groupsAllInConnection([own.id], CONN)).toBe(true);
		expect(await store.groupsAllInConnection([own.id, foreign.id], CONN)).toBe(false);
		expect(await store.groupsAllInConnection([], CONN)).toBe(true);
	});

	it('STORE-SEARCH-ESCAPE: LIKE wildcards in a search term match literally, parity with local (§B7)', async () => {
		await store.upsertUser(
			CONN,
			upsertInput({ externalId: 'e1', username: 'a%b', email: 'a@x.com' }),
		);
		await store.upsertUser(
			CONN,
			upsertInput({ externalId: 'e2', username: 'axxb', email: 'b@x.com' }),
		);
		await store.upsertUser(
			CONN,
			upsertInput({ externalId: 'e3', username: 'a_b', email: 'c@x.com' }),
		);
		await store.upsertUser(
			CONN,
			upsertInput({ externalId: 'e4', username: 'azb', email: 'd@x.com' }),
		);

		// '%' must match only the literal 'a%b' — not 'axxb' (which an unescaped '%' wildcard would match).
		const pct = await store.listUsers({ limit: 50, offset: 0, search: 'a%b' });
		expect(pct.items.map((u) => u.username)).toEqual(['a%b']);

		// '_' must match only the literal 'a_b' — not 'azb' (which an unescaped '_' wildcard would match).
		const us = await store.listUsers({ limit: 50, offset: 0, search: 'a_b' });
		expect(us.items.map((u) => u.username)).toEqual(['a_b']);
	});

	it('STORE-LOCKOUT-CLEAR: upstream credential rotation clears the brute-force lockout, parity with local (§B7)', async () => {
		const recordSuccess = jest.fn().mockResolvedValue(undefined);
		const lockoutStore = new SqlIdentityStore(handle.db, 'postgres', {
			recordSuccess,
		} as never);
		const hashA = '$2b$12$AAAAAAAAAAAAAAAAAAAAAA';
		await lockoutStore.upsertUser(CONN, upsertInput({ passwordHash: hashA }));
		// Re-sync with the same hash → nothing to clear.
		await lockoutStore.upsertUser(CONN, upsertInput({ passwordHash: hashA }));
		expect(recordSuccess).not.toHaveBeenCalled();
		// Re-sync with a rotated hash → clear the lockout for this account.
		await lockoutStore.upsertUser(
			CONN,
			upsertInput({ passwordHash: '$2b$12$BBBBBBBBBBBBBBBBBBBBBB' }),
		);
		expect(recordSuccess).toHaveBeenCalledWith('end_user', 'alice');
	});

	it('STORE-ORIGIN-VALIDATE: a corrupt origin value is rejected on read, not silently cast (§B6)', async () => {
		const user = await store.upsertUser(CONN, upsertInput());
		// Tamper with the free-form varchar origin directly (no CHECK constraint on the external table).
		await handle.db
			.updateTable('nestidp_user')
			.set({ origin: 'BOGUS' })
			.where('id', '=', user.id)
			.execute();
		await expect(store.getUserById(user.id)).rejects.toThrow(/Unexpected identity origin 'BOGUS'/);
	});
});
