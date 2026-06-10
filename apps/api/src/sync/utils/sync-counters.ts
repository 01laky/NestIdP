/** DTO-safe counter struct passed to finishLog/audit on every terminal path (§5.B3). */
export interface SyncCounterSnapshot {
	usersSynced: number;
	groupsSynced: number;
	rolesSynced: number;
	usersSkippedCollision: number;
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
	/** Orphan rows removed in phase C; captured for diagnostics (not yet persisted, see D5). */
	groupsDeactivated = 0;
	rolesDeactivated = 0;

	readonly seenUserExternalIds = new Set<string>();
	readonly seenGroupExternalIds = new Set<string>();
	readonly seenRoleExternalIds = new Set<string>();
	readonly upsertedGroupExternalIds = new Set<string>();
	readonly upsertedRoleExternalIds = new Set<string>();

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

	setDeactivated(kind: 'group' | 'role', count: number): void {
		if (kind === 'group') {
			this.groupsDeactivated = count;
		} else {
			this.rolesDeactivated = count;
		}
	}

	/**
	 * The single destructure point for finalizeRun (§5.B3): every terminal path — SUCCESS, early
	 * bearer/fetch failure, catch-all FAILED — reports the same full four-field shape.
	 */
	toCounterSnapshot(): SyncCounterSnapshot {
		return {
			usersSynced: this.usersSynced,
			groupsSynced: this.groupsSynced,
			rolesSynced: this.rolesSynced,
			usersSkippedCollision: this.usersSkippedCollision,
		};
	}
}
