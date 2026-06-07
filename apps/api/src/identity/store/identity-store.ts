import type { IdentityOrigin } from '@prisma/client';

/**
 * IdentityStore — the single data-access seam for identity entities (User/Group/Role + memberships).
 *
 * The local implementation (`IdentityRepository`) talks to libSQL via Prisma; an external
 * implementation (`SqlIdentityStore`, Prompt 31) talks to a customer Postgres/MySQL via Kysely. All
 * identity consumers (auth, SAML, sync, identity-admin, stats) go through `ActiveIdentityStore`, which
 * delegates to whichever implementation is currently active (local / external / mirror).
 *
 * The store is intentionally data-only: hashing, email normalization, DTO mapping, audit, and the
 * (always-local) ApiConnection/AuditEvent joins stay in the calling services.
 */

/** Full user row incl. password hash — used by end-user login. */
export interface StoreUser {
	id: string;
	externalId: string;
	apiConnectionId: string;
	origin: IdentityOrigin;
	username: string;
	email: string | null;
	displayName: string | null;
	passwordHash: string;
	passwordHashAlgorithm: string;
	active: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface StoreGroup {
	id: string;
	externalId: string;
	apiConnectionId: string;
	origin: IdentityOrigin;
	name: string;
	createdAt: Date;
	updatedAt: Date;
}

export type StoreRole = StoreGroup;

export type StoreGroupWithCount = StoreGroup & { memberCount: number };
export type StoreRoleWithCount = StoreRole & { memberCount: number };

export interface StoreMember {
	id: string;
	username: string;
	origin: IdentityOrigin;
}

export interface StoreNamedRef {
	id: string;
	name: string;
	origin: IdentityOrigin;
}

/** Profile used to build SAML assertions and login responses. */
export interface UserProfileForAuth {
	id: string;
	username: string;
	email: string | null;
	displayName: string | null;
	active: boolean;
	groups: string[];
	roles: string[];
}

export interface UpsertUserInput {
	externalId: string;
	username: string;
	email: string | null;
	displayName: string | null;
	passwordHash: string;
	passwordHashAlgorithm: string;
	active: boolean;
}

export interface ListQuery {
	limit: number;
	offset: number;
	search?: string;
	origin?: IdentityOrigin;
}

export interface ListResult<T> {
	items: T[];
	total: number;
}

export interface UserWithMemberships {
	user: StoreUser;
	groups: StoreNamedRef[];
	roles: StoreNamedRef[];
}

export interface CreateManualUserInput {
	apiConnectionId: string;
	username: string;
	email: string | null;
	displayName: string | null;
	passwordHash: string;
	passwordHashAlgorithm: string;
	active: boolean;
	groupIds: string[];
	roleIds: string[];
}

export interface UpdateManualUserInput {
	username?: string;
	email?: string | null;
	displayName?: string | null;
	active?: boolean;
	passwordHash?: string;
	groupIds?: string[];
	roleIds?: string[];
}

export interface IdentityStore {
	// --- counts (dashboard) ---
	countUsers(): Promise<number>;
	countGroups(): Promise<number>;
	countRoles(): Promise<number>;

	// --- auth / SAML reads ---
	findUserByUsername(username: string): Promise<StoreUser | null>;
	findUserProfileById(userId: string): Promise<UserProfileForAuth | null>;

	// --- inbound sync writes ---
	upsertUser(connectionId: string, user: UpsertUserInput): Promise<{ id: string }>;
	replaceUserGroups(userId: string, groupIds: string[]): Promise<void>;
	replaceUserRoles(userId: string, roleIds: string[]): Promise<void>;
	upsertGroup(connectionId: string, externalGroup: { id: string; name: string }): Promise<{ id: string }>;
	upsertRole(connectionId: string, externalRole: { id: string; name: string }): Promise<{ id: string }>;
	deactivateUsersNotInExternalIds(connectionId: string, externalIds: Set<string>): Promise<number>;
	deleteOrphanGroups(connectionId: string, seenExternalIds: Set<string>): Promise<number>;
	deleteOrphanRoles(connectionId: string, seenExternalIds: Set<string>): Promise<number>;

	// --- admin: users ---
	listUsers(query: ListQuery): Promise<ListResult<StoreUser>>;
	getUserById(id: string): Promise<StoreUser | null>;
	getUserWithMemberships(id: string): Promise<UserWithMemberships | null>;
	createManualUser(input: CreateManualUserInput): Promise<StoreUser>;
	updateManualUser(id: string, input: UpdateManualUserInput): Promise<void>;
	deleteUser(id: string): Promise<void>;
	isUsernameTaken(username: string, excludeId?: string): Promise<boolean>;
	groupsExistAll(ids: string[]): Promise<boolean>;
	rolesExistAll(ids: string[]): Promise<boolean>;

	// --- admin: groups ---
	listGroups(query: ListQuery): Promise<ListResult<StoreGroupWithCount>>;
	getGroupById(id: string): Promise<StoreGroupWithCount | null>;
	getGroupMembers(id: string, max: number): Promise<StoreMember[]>;
	createManualGroup(apiConnectionId: string, name: string): Promise<StoreGroup>;
	updateGroupName(id: string, name: string): Promise<void>;
	deleteGroup(id: string): Promise<void>;
	groupMemberCount(id: string): Promise<number>;
	isGroupNameTaken(apiConnectionId: string, name: string, excludeId?: string): Promise<boolean>;

	// --- admin: roles ---
	listRoles(query: ListQuery): Promise<ListResult<StoreRoleWithCount>>;
	getRoleById(id: string): Promise<StoreRoleWithCount | null>;
	getRoleMembers(id: string, max: number): Promise<StoreMember[]>;
	createManualRole(apiConnectionId: string, name: string): Promise<StoreRole>;
	updateRoleName(id: string, name: string): Promise<void>;
	deleteRole(id: string): Promise<void>;
	roleMemberCount(id: string): Promise<number>;
	isRoleNameTaken(apiConnectionId: string, name: string, excludeId?: string): Promise<boolean>;
}
