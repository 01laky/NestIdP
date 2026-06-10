/** Mutable per-run sync counters (Prompt 38 §6.8) — replaces four loose `let`s in triggerSync. */
export class SyncCounters {
	usersSynced = 0;
	groupsSynced = 0;
	rolesSynced = 0;
	usersSkippedCollision = 0;

	/**
	 * Failure-before-user-phase shape: these finishLog calls historically omit
	 * usersSkippedCollision (necessarily still 0 before any user upsert) — preserved verbatim.
	 */
	withoutCollisions(): { usersSynced: number; groupsSynced: number; rolesSynced: number } {
		return {
			usersSynced: this.usersSynced,
			groupsSynced: this.groupsSynced,
			rolesSynced: this.rolesSynced,
		};
	}

	snapshot(): {
		usersSynced: number;
		groupsSynced: number;
		rolesSynced: number;
		usersSkippedCollision: number;
	} {
		return { ...this.withoutCollisions(), usersSkippedCollision: this.usersSkippedCollision };
	}
}
