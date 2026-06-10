import type { IdentityStore } from '../identity-store';

/**
 * The read-only {@link IdentityStore} methods. This is an inverted allowlist (Prompt 38 §A18): the
 * mirroring proxy treats every store method NOT listed here as a mutation, so a newly added method flags
 * external drift by default (fail-safe) instead of silently diverging — the failure mode that left
 * `removeConnectionIdentities` unregistered in the previous mutating-method allowlist (§5.B5).
 *
 * Keep in sync with the read methods of {@link IdentityStore}; the `mirroring-identity-store.spec`
 * enumeration test fails if a real store method is neither listed here nor wrapped as a mutation.
 */
export const READ_ONLY_METHODS: ReadonlySet<string> = new Set([
	// counts
	'countUsers',
	'countGroups',
	'countRoles',
	'countsByConnection',
	'syncedUserIdsForConnection',
	// auth / SAML reads
	'findUserByUsername',
	'findUserProfileById',
	// admin: users (reads)
	'listUsers',
	'getUserById',
	'getUserWithMemberships',
	'isUsernameTaken',
	'groupsExistAll',
	'rolesExistAll',
	'groupsAllInConnection',
	'rolesAllInConnection',
	// admin: groups (reads)
	'listGroups',
	'getGroupById',
	'getGroupMembers',
	'groupMemberCount',
	'isGroupNameTaken',
	// admin: roles (reads)
	'listRoles',
	'getRoleById',
	'getRoleMembers',
	'roleMemberCount',
	'isRoleNameTaken',
	// replication / integrity reads
	'exportAll',
	'connectionHasIdentityRows',
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
			const propStr = String(prop);
			// Never wrap JS machinery (toString/valueOf/constructor/…) or read-only store methods.
			const isBuiltin = typeof prop === 'symbol' || propStr in Object.prototype;
			const fn = value as (...args: unknown[]) => unknown;
			if (isBuiltin || READ_ONLY_METHODS.has(propStr)) {
				return fn.bind(target);
			}
			// Fail-safe: anything else is treated as a mutation and flags the external mirror stale.
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
