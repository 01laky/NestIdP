/** DTO-safe counter struct passed to finishLog/audit on every terminal path (§5.B3). */
export interface SyncCounterSnapshot {
	usersSynced: number;
	groupsSynced: number;
	rolesSynced: number;
	usersSkippedCollision: number;
	groupsDeactivated: number;
	rolesDeactivated: number;
}

/**
 * Mutable per-run sync state (Prompt 38 §6.8 / Prompt 39 D1a) — replaces the four loose `let`
 * counters and five `Set`s that triggerSync used to thread through its phases. The "count an
 * upsert once per external id" pattern lives in addGroupOnce/addRoleOnce so call sites cannot
 * desynchronize the set and the counter.
 */
export class SyncCounters {
	usersSynced = 0;
	groupsSynced = 0;
	rolesSynced = 0;
	usersSkippedCollision = 0;
	/** Orphan rows removed in phase C; persisted on SyncLog (Prompt 39 D5). Stays 0 on dry runs. */
	groupsDeactivated = 0;
	rolesDeactivated = 0;

	readonly seenUserExternalIds = new Set<string>();
	readonly seenGroupExternalIds = new Set<string>();
	readonly seenRoleExternalIds = new Set<string>();
	readonly upsertedGroupExternalIds = new Set<string>();
	readonly upsertedRoleExternalIds = new Set<string>();

	/**
	 * Set when ≥1 user's membership fetch failed this run. The "seen" set for that kind is then
	 * incomplete, so orphan deletion is skipped for it — deleting a group/role that is only "unseen"
	 * because the user listing it failed to fetch would cascade-delete still-valid memberships
	 * (FK onDelete: Cascade). Conservative: a few stale orphans survive until the next clean run.
	 */
	private readonly membershipFetchFailed = { group: false, role: false };

	addUser(): void {
		this.usersSynced += 1;
	}

	addCollision(): void {
		this.usersSkippedCollision += 1;
	}

	/** Counts a group upsert once per external id; returns whether this call counted it. */
	addGroupOnce(externalId: string): boolean {
		if (this.upsertedGroupExternalIds.has(externalId)) {
			return false;
		}
		this.upsertedGroupExternalIds.add(externalId);
		this.groupsSynced += 1;
		return true;
	}

	/** Counts a role upsert once per external id; returns whether this call counted it. */
	addRoleOnce(externalId: string): boolean {
		if (this.upsertedRoleExternalIds.has(externalId)) {
			return false;
		}
		this.upsertedRoleExternalIds.add(externalId);
		this.rolesSynced += 1;
		return true;
	}

	/** Record that a membership fetch failed for ≥1 user of this kind (gates orphan deletion). */
	markMembershipFetchFailed(kind: 'group' | 'role'): void {
		this.membershipFetchFailed[kind] = true;
	}

	/** True when orphan deletion for this kind must be skipped (its "seen" census is incomplete). */
	shouldSkipOrphanDeletion(kind: 'group' | 'role'): boolean {
		return this.membershipFetchFailed[kind];
	}

	setDeactivated(kind: 'group' | 'role', count: number): void {
		if (kind === 'group') {
			this.groupsDeactivated = count;
		} else {
			this.rolesDeactivated = count;
		}
	}

	/**
	 * The single destructure point for finalizeRun (§5.B3): every terminal path — SUCCESS, early
	 * bearer/fetch failure, catch-all FAILED — reports the same full six-field shape.
	 */
	toCounterSnapshot(): SyncCounterSnapshot {
		return {
			usersSynced: this.usersSynced,
			groupsSynced: this.groupsSynced,
			rolesSynced: this.rolesSynced,
			usersSkippedCollision: this.usersSkippedCollision,
			groupsDeactivated: this.groupsDeactivated,
			rolesDeactivated: this.rolesDeactivated,
		};
	}
}
