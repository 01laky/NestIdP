import { createMirroringStore } from '@api/identity/store/external/mirroring-identity-store';
import type { IdentityStore } from '@api/identity/store/identity-store';

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
});
