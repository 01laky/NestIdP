import {
	createMirroringStore,
	READ_ONLY_METHODS,
} from '@api/identity/store/external/mirroring-identity-store';
import { IdentityRepository } from '@api/identity/identity.repository';
import { SqlIdentityStore } from '@api/identity/store/external/sql-identity-store';
import type { IdentityStore } from '@api/identity/store/identity-store';

// The full IdentityStore surface, partitioned. Adding an interface method without classifying it here
// fails IDN-MIRROR-ENUM; at runtime an unclassified method is treated as a mutation (fail-safe).
const READ_METHODS = [
	'countUsers',
	'countGroups',
	'countRoles',
	'countsByConnection',
	'syncedUserIdsForConnection',
	'findUserByUsername',
	'findUserProfileById',
	'listUsers',
	'getUserById',
	'getUserWithMemberships',
	'isUsernameTaken',
	'groupsExistAll',
	'rolesExistAll',
	'groupsAllInConnection',
	'rolesAllInConnection',
	'listGroups',
	'getGroupById',
	'getGroupMembers',
	'groupMemberCount',
	'isGroupNameTaken',
	'listRoles',
	'getRoleById',
	'getRoleMembers',
	'roleMemberCount',
	'isRoleNameTaken',
	'exportAll',
	'connectionHasIdentityRows',
];
const MUTATING_METHODS = [
	'removeConnectionIdentities',
	'upsertUser',
	'replaceUserGroups',
	'replaceUserRoles',
	'upsertGroup',
	'upsertRole',
	'deactivateUsersNotInExternalIds',
	'deleteOrphanGroups',
	'deleteOrphanRoles',
	'createManualUser',
	'updateManualUser',
	'deleteUser',
	'createManualGroup',
	'updateGroupName',
	'deleteGroup',
	'createManualRole',
	'updateRoleName',
	'deleteRole',
	'importSnapshot',
	'wipeAll',
];

describe('createMirroringStore (§5.B5)', () => {
	function fakeLocal(): IdentityStore {
		return {
			// a representative mutation (Prompt 37) + a representative read
			removeConnectionIdentities: jest
				.fn()
				.mockResolvedValue({ usersRemoved: 2, groupsRemoved: 0, rolesRemoved: 0 }),
			countsByConnection: jest.fn().mockResolvedValue({ users: {}, groups: {}, roles: {} }),
			deleteUser: jest.fn().mockResolvedValue(undefined),
		} as unknown as IdentityStore;
	}

	it('IDN-MIRROR-01: removeConnectionIdentities flags the external mirror stale', async () => {
		const onMutate = jest.fn();
		const local = fakeLocal();
		const store = createMirroringStore(local, onMutate);

		await store.removeConnectionIdentities('conn-1', 'delete');

		expect(local.removeConnectionIdentities).toHaveBeenCalledWith('conn-1', 'delete');
		expect(onMutate).toHaveBeenCalledTimes(1);
	});

	it('IDN-MIRROR-02: another mutation (deleteUser) also flags drift', async () => {
		const onMutate = jest.fn();
		const store = createMirroringStore(fakeLocal(), onMutate);
		await store.deleteUser('u1');
		expect(onMutate).toHaveBeenCalledTimes(1);
	});

	it('IDN-MIRROR-03: a read (countsByConnection) does NOT flag drift', async () => {
		const onMutate = jest.fn();
		const store = createMirroringStore(fakeLocal(), onMutate);
		await store.countsByConnection();
		expect(onMutate).not.toHaveBeenCalled();
	});

	it('IDN-MIRROR-04: a failing onMutate never breaks the primary local write', async () => {
		const onMutate = jest.fn(() => {
			throw new Error('drift-flag boom');
		});
		const store = createMirroringStore(fakeLocal(), onMutate);
		await expect(store.deleteUser('u1')).resolves.toBeUndefined();
	});

	it('IDN-MIRROR-05: an UNREGISTERED method is treated as a mutation (fail-safe inversion, §A18)', async () => {
		const onMutate = jest.fn();
		const fake = {
			brandNewWrite: jest.fn().mockResolvedValue(undefined),
			countUsers: jest.fn().mockResolvedValue(0),
		} as unknown as IdentityStore & { brandNewWrite: () => Promise<void> };
		const store = createMirroringStore(fake, onMutate) as typeof fake;
		await store.brandNewWrite();
		expect(onMutate).toHaveBeenCalledTimes(1); // not in READ_ONLY → flagged stale by default
		await store.countUsers();
		expect(onMutate).toHaveBeenCalledTimes(1); // read → no extra flag
	});

	it('IDN-MIRROR-06: built-in Object methods are not wrapped as mutations', () => {
		const onMutate = jest.fn();
		const store = createMirroringStore(fakeLocal(), onMutate);
		expect(typeof store.toString()).toBe('string');
		expect(onMutate).not.toHaveBeenCalled();
	});

	it('IDN-MIRROR-ENUM: every store method is classified, and each mutation flags drift while reads do not', async () => {
		// READ_ONLY_METHODS is exactly the documented read set — disjoint from the mutating set.
		expect([...READ_ONLY_METHODS].sort()).toEqual([...READ_METHODS].sort());
		const overlap = MUTATING_METHODS.filter((m) => READ_ONLY_METHODS.has(m));
		expect(overlap).toEqual([]);

		// Every classified name is a real method on both store implementations (catches renames/removals).
		const all = [...READ_METHODS, ...MUTATING_METHODS];
		const localProto = IdentityRepository.prototype as unknown as Record<string, unknown>;
		const extProto = SqlIdentityStore.prototype as unknown as Record<string, unknown>;
		for (const name of all) {
			expect(typeof localProto[name]).toBe('function');
			expect(typeof extProto[name]).toBe('function');
		}

		// Behavioural partition: mutations flag drift, reads do not.
		const fake = Object.fromEntries(
			all.map((m) => [m, jest.fn().mockResolvedValue(undefined)]),
		) as unknown as IdentityStore;
		for (const name of MUTATING_METHODS) {
			const onMutate = jest.fn();
			await (
				createMirroringStore(fake, onMutate) as unknown as Record<string, () => Promise<void>>
			)[name]();
			expect(onMutate).toHaveBeenCalledTimes(1);
		}
		for (const name of READ_METHODS) {
			const onMutate = jest.fn();
			await (
				createMirroringStore(fake, onMutate) as unknown as Record<string, () => Promise<void>>
			)[name]();
			expect(onMutate).not.toHaveBeenCalled();
		}
	});
});
