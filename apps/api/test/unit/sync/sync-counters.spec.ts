import { SyncCounters } from '@api/sync/utils/sync-counters';

describe('SyncCounters (Prompt 39 D1a)', () => {
	it('CNT-01: toCounterSnapshot returns exactly the six counter fields', () => {
		const counters = new SyncCounters();
		counters.addUser();
		counters.addGroupOnce('g1');
		counters.addRoleOnce('r1');
		counters.addCollision();

		expect(counters.toCounterSnapshot()).toEqual({
			usersSynced: 1,
			groupsSynced: 1,
			rolesSynced: 1,
			usersSkippedCollision: 1,
			groupsDeactivated: 0,
			rolesDeactivated: 0,
		});
		expect(Object.keys(counters.toCounterSnapshot())).toHaveLength(6);
	});

	it('CNT-02: addGroupOnce counts on first call and returns false on repeat', () => {
		const counters = new SyncCounters();
		expect(counters.addGroupOnce('g1')).toBe(true);
		expect(counters.addGroupOnce('g1')).toBe(false);
		expect(counters.groupsSynced).toBe(1);
		expect(counters.upsertedGroupExternalIds).toEqual(new Set(['g1']));
	});

	it('CNT-03: addRoleOnce counts on first call and returns false on repeat', () => {
		const counters = new SyncCounters();
		expect(counters.addRoleOnce('r1')).toBe(true);
		expect(counters.addRoleOnce('r1')).toBe(false);
		expect(counters.rolesSynced).toBe(1);
		expect(counters.upsertedRoleExternalIds).toEqual(new Set(['r1']));
	});

	it('CNT-04: addCollision increments only usersSkippedCollision', () => {
		const counters = new SyncCounters();
		counters.addCollision();

		expect(counters.usersSkippedCollision).toBe(1);
		expect(counters.usersSynced).toBe(0);
		expect(counters.groupsSynced).toBe(0);
		expect(counters.rolesSynced).toBe(0);
		expect(counters.groupsDeactivated).toBe(0);
		expect(counters.rolesDeactivated).toBe(0);
	});

	it('CNT-05: setDeactivated stores the per-kind orphan delete count', () => {
		const counters = new SyncCounters();
		counters.setDeactivated('group', 3);
		counters.setDeactivated('role', 5);

		expect(counters.groupsDeactivated).toBe(3);
		expect(counters.rolesDeactivated).toBe(5);
		// Prompt 39 D5: deactivation counts are part of the finishLog snapshot and persisted.
		expect(counters.toCounterSnapshot()).toEqual({
			usersSynced: 0,
			groupsSynced: 0,
			rolesSynced: 0,
			usersSkippedCollision: 0,
			groupsDeactivated: 3,
			rolesDeactivated: 5,
		});
	});

	it('CNT-06: membership-fetch-failure flag gates orphan deletion per kind, independently', () => {
		const counters = new SyncCounters();
		// Nothing failed yet → neither kind is skipped.
		expect(counters.shouldSkipOrphanDeletion('group')).toBe(false);
		expect(counters.shouldSkipOrphanDeletion('role')).toBe(false);

		counters.markMembershipFetchFailed('group');

		// A group fetch failure must not gate role orphan deletion (independent flags).
		expect(counters.shouldSkipOrphanDeletion('group')).toBe(true);
		expect(counters.shouldSkipOrphanDeletion('role')).toBe(false);
	});
});
