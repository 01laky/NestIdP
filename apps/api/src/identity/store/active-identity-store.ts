import { Injectable } from '@nestjs/common';
import { IdentityRepository } from '../identity.repository';
import type {
	CreateManualUserInput,
	IdentityStore,
	ListQuery,
	ListResult,
	StoreGroup,
	StoreGroupWithCount,
	StoreMember,
	StoreRole,
	StoreRoleWithCount,
	StoreUser,
	UpdateManualUserInput,
	UpsertUserInput,
	UserProfileForAuth,
	UserWithMemberships,
} from './identity-store';

export type IdentityStoreMode = 'local' | 'external' | 'mirror';

/**
 * The injected identity store seen by every consumer (auth, SAML, sync, identity-admin, stats).
 * It delegates to the currently-active {@link IdentityStore} implementation and supports an atomic
 * hot-swap (Prompt 31) so an external database can be attached/detached at runtime with no restart.
 * Default delegate is the local libSQL {@link IdentityRepository}.
 */
@Injectable()
export class ActiveIdentityStore implements IdentityStore {
	private current: IdentityStore;
	private currentMode: IdentityStoreMode = 'local';

	constructor(private readonly local: IdentityRepository) {
		this.current = local;
	}

	/** Swap the active delegate atomically. Pass the local repo (or mode 'local') to revert. */
	setActive(store: IdentityStore, mode: IdentityStoreMode): void {
		this.current = store;
		this.currentMode = mode;
	}

	revertToLocal(): void {
		this.current = this.local;
		this.currentMode = 'local';
	}

	getActive(): IdentityStore {
		return this.current;
	}

	getLocal(): IdentityRepository {
		return this.local;
	}

	mode(): IdentityStoreMode {
		return this.currentMode;
	}

	// --- counts ---
	countUsers(): Promise<number> {
		return this.current.countUsers();
	}
	countGroups(): Promise<number> {
		return this.current.countGroups();
	}
	countRoles(): Promise<number> {
		return this.current.countRoles();
	}

	// --- auth / SAML ---
	findUserByUsername(username: string): Promise<StoreUser | null> {
		return this.current.findUserByUsername(username);
	}
	findUserProfileById(userId: string): Promise<UserProfileForAuth | null> {
		return this.current.findUserProfileById(userId);
	}

	// --- inbound sync ---
	upsertUser(connectionId: string, user: UpsertUserInput): Promise<{ id: string }> {
		return this.current.upsertUser(connectionId, user);
	}
	replaceUserGroups(userId: string, groupIds: string[]): Promise<void> {
		return this.current.replaceUserGroups(userId, groupIds);
	}
	replaceUserRoles(userId: string, roleIds: string[]): Promise<void> {
		return this.current.replaceUserRoles(userId, roleIds);
	}
	upsertGroup(connectionId: string, externalGroup: { id: string; name: string }): Promise<{ id: string }> {
		return this.current.upsertGroup(connectionId, externalGroup);
	}
	upsertRole(connectionId: string, externalRole: { id: string; name: string }): Promise<{ id: string }> {
		return this.current.upsertRole(connectionId, externalRole);
	}
	deactivateUsersNotInExternalIds(connectionId: string, externalIds: Set<string>): Promise<number> {
		return this.current.deactivateUsersNotInExternalIds(connectionId, externalIds);
	}
	deleteOrphanGroups(connectionId: string, seenExternalIds: Set<string>): Promise<number> {
		return this.current.deleteOrphanGroups(connectionId, seenExternalIds);
	}
	deleteOrphanRoles(connectionId: string, seenExternalIds: Set<string>): Promise<number> {
		return this.current.deleteOrphanRoles(connectionId, seenExternalIds);
	}

	// --- admin: users ---
	listUsers(query: ListQuery): Promise<ListResult<StoreUser>> {
		return this.current.listUsers(query);
	}
	getUserById(id: string): Promise<StoreUser | null> {
		return this.current.getUserById(id);
	}
	getUserWithMemberships(id: string): Promise<UserWithMemberships | null> {
		return this.current.getUserWithMemberships(id);
	}
	createManualUser(input: CreateManualUserInput): Promise<StoreUser> {
		return this.current.createManualUser(input);
	}
	updateManualUser(id: string, input: UpdateManualUserInput): Promise<void> {
		return this.current.updateManualUser(id, input);
	}
	deleteUser(id: string): Promise<void> {
		return this.current.deleteUser(id);
	}
	isUsernameTaken(username: string, excludeId?: string): Promise<boolean> {
		return this.current.isUsernameTaken(username, excludeId);
	}
	groupsExistAll(ids: string[]): Promise<boolean> {
		return this.current.groupsExistAll(ids);
	}
	rolesExistAll(ids: string[]): Promise<boolean> {
		return this.current.rolesExistAll(ids);
	}

	// --- admin: groups ---
	listGroups(query: ListQuery): Promise<ListResult<StoreGroupWithCount>> {
		return this.current.listGroups(query);
	}
	getGroupById(id: string): Promise<StoreGroupWithCount | null> {
		return this.current.getGroupById(id);
	}
	getGroupMembers(id: string, max: number): Promise<StoreMember[]> {
		return this.current.getGroupMembers(id, max);
	}
	createManualGroup(apiConnectionId: string, name: string): Promise<StoreGroup> {
		return this.current.createManualGroup(apiConnectionId, name);
	}
	updateGroupName(id: string, name: string): Promise<void> {
		return this.current.updateGroupName(id, name);
	}
	deleteGroup(id: string): Promise<void> {
		return this.current.deleteGroup(id);
	}
	groupMemberCount(id: string): Promise<number> {
		return this.current.groupMemberCount(id);
	}
	isGroupNameTaken(apiConnectionId: string, name: string, excludeId?: string): Promise<boolean> {
		return this.current.isGroupNameTaken(apiConnectionId, name, excludeId);
	}

	// --- admin: roles ---
	listRoles(query: ListQuery): Promise<ListResult<StoreRoleWithCount>> {
		return this.current.listRoles(query);
	}
	getRoleById(id: string): Promise<StoreRoleWithCount | null> {
		return this.current.getRoleById(id);
	}
	getRoleMembers(id: string, max: number): Promise<StoreMember[]> {
		return this.current.getRoleMembers(id, max);
	}
	createManualRole(apiConnectionId: string, name: string): Promise<StoreRole> {
		return this.current.createManualRole(apiConnectionId, name);
	}
	updateRoleName(id: string, name: string): Promise<void> {
		return this.current.updateRoleName(id, name);
	}
	deleteRole(id: string): Promise<void> {
		return this.current.deleteRole(id);
	}
	roleMemberCount(id: string): Promise<number> {
		return this.current.roleMemberCount(id);
	}
	isRoleNameTaken(apiConnectionId: string, name: string, excludeId?: string): Promise<boolean> {
		return this.current.isRoleNameTaken(apiConnectionId, name, excludeId);
	}
}
