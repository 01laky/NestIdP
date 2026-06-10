/**
 * Store-agnostic identity collision errors (Prompt 38 §A18). Both the local (Prisma) `IdentityRepository`
 * and the external (Kysely) `SqlIdentityStore` raise these; keeping them in a neutral file means the
 * external store no longer has to import from the Prisma-bound repository module just to throw them.
 */
export class UsernameCollisionError extends Error {
	constructor(
		public readonly externalUserId: string,
		public readonly username: string,
	) {
		super(`Username already in use: ${username}`);
		this.name = 'UsernameCollisionError';
	}
}

export class GroupNameCollisionError extends Error {
	constructor(
		public readonly externalGroupId: string,
		public readonly name: string,
	) {
		super(`Group name already in use: ${name}`);
		this.name = 'GroupNameCollisionError';
	}
}

export class RoleNameCollisionError extends Error {
	constructor(
		public readonly externalRoleId: string,
		public readonly name: string,
	) {
		super(`Role name already in use: ${name}`);
		this.name = 'RoleNameCollisionError';
	}
}

export class MembershipCrossConnectionError extends Error {
	constructor(public readonly kind: 'group' | 'role') {
		super(`Cannot assign a ${kind} from a different identity source`);
		this.name = 'MembershipCrossConnectionError';
	}
}
