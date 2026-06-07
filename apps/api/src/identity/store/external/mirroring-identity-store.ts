import type { IdentityStore } from '../identity-store';

const MUTATING_METHODS = new Set<string>([
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
]);

/**
 * Mirror mode (Prompt 31, keep-local toggle ON): the local store stays authoritative for reads and
 * writes; after any mutation the external copy is flagged stale via `onMutate`. The external database
 * is brought back in sync by the Re-sync action (full local→external reconcile). This keeps the app
 * fully functional even if the external mirror is unreachable (eventually consistent).
 */
export function createMirroringStore(local: IdentityStore, onMutate: () => void): IdentityStore {
	return new Proxy(local, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (typeof value !== 'function') {
				return value;
			}
			const fn = value as (...args: unknown[]) => unknown;
			if (!MUTATING_METHODS.has(String(prop))) {
				return fn.bind(target);
			}
			return async (...args: unknown[]) => {
				const result = await fn.apply(target, args);
				try {
					onMutate();
				} catch {
					// flagging drift must never break the primary (local) write
				}
				return result;
			};
		},
	}) as IdentityStore;
}
