import { SyncCounters } from '@api/sync/utils/sync-counters';

describe('SyncCounters (Prompt 39 D1a)', () => {
	it('CNT-01: toCounterSnapshot returns exactly the four counter fields', () => {
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
		});
		expect(Object.keys(counters.toCounterSnapshot())).toHaveLength(4);
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
		// Deactivation counts are diagnostics — never part of the finishLog snapshot.
		expect(counters.toCounterSnapshot()).toEqual({
			usersSynced: 0,
			groupsSynced: 0,
			rolesSynced: 0,
			usersSkippedCollision: 0,
		});
	});
});
