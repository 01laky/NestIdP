import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Inject,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import type {
	CreateManualIdentityGroupDto,
	CreateManualIdentityRoleDto,
	CreateManualIdentityUserDto,
	IdentityGroupDetailResponseDto,
	IdentityGroupListResponseDto,
	IdentityRoleDetailResponseDto,
	IdentityRoleListResponseDto,
	IdentitySourceOptionDto,
	IdentityUserDetailResponseDto,
	IdentityUserListResponseDto,
	UpdateManualIdentityGroupDto,
	UpdateManualIdentityRoleDto,
	UpdateManualIdentityUserDto,
	UnlockAccountResponseDto,
} from '@nestidp/shared';
import { LOCAL_DIRECTORY_CONNECTION_NAME, apiConnectionAdminRoute } from '@nestidp/shared';
import {
	AccountLockoutService,
	toAccountLockoutStatusDto,
} from '../../auth-protection/account-lockout.service';
import { AuthProtectionAuditService } from '../../auth-protection/auth-protection-audit.service';
import { IdentityOrigin } from '@prisma/client';
import { hashPassword } from '../../admin-auth/utils/password.util';
import {
	CREDENTIALS_ENCRYPTION,
	type CredentialsEncryptionPort,
} from '../../encryption/credentials-encryption.port';
import { isCuid } from '../../common/pipes/parse-cuid.pipe';
import { normalizeSyncedEmail } from '../../identity/utils/normalize-synced-email.util';
import { ActiveIdentityStore } from '../../identity/store/active-identity-store';
import type { StoreGroup, StoreRole, StoreUser } from '../../identity/store/identity-store';
import {
	ensureLocalDirectoryConnection,
	toOriginLiteral,
} from '../../identity/utils/local-directory.util';
import { PrismaService } from '../../prisma/services/prisma.service';
import { SamlSsoSessionService } from '../../saml-sessions/services/saml-sso-session.service';
import { IdentityAdminAuditService } from './identity-admin-audit.service';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_AUDIT_LIMIT = 20;
// Detail responses truncate the member list at this cap; the web detail page shows "of N" via the
// untruncated `memberCount` field, so larger groups/roles are not silently misrepresented.
const MAX_MEMBERS = 500;

@Injectable()
export class IdentityAdminService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly store: ActiveIdentityStore,
		@Inject(CREDENTIALS_ENCRYPTION)
		private readonly encryption: CredentialsEncryptionPort,
		private readonly audit: IdentityAdminAuditService,
		private readonly ssoSessions: SamlSsoSessionService,
		private readonly accountLockout: AccountLockoutService,
		private readonly protectionAudit: AuthProtectionAuditService,
	) {}

	async listUsers(
		limitRaw?: number,
		offsetRaw?: number,
		search?: string,
		originFilter?: string,
		apiConnectionId?: string,
	): Promise<IdentityUserListResponseDto> {
		const limit = this.parseLimit(limitRaw);
		const offset = this.parseOffset(offsetRaw);
		const { items, total } = await this.store.listUsers({
			limit,
			offset,
			search,
			origin: this.parseOrigin(originFilter),
			apiConnectionId: this.parseApiConnectionId(apiConnectionId),
		});
		const mapped = items.map((row) => this.toUserListItem(row));
		const statuses = await this.accountLockout.getStatusMany(
			'end_user',
			mapped.map((u) => u.username.trim()),
		);
		return {
			items: mapped.map((u) => ({
				...u,
				lockout: toAccountLockoutStatusDto(
					statuses.get(u.username.trim()) ?? {
						locked: false,
						lockedUntil: null,
						failedCount: 0,
						lastFailedAt: null,
					},
				),
			})),
			total,
			sources: await this.listSourceOptions(),
		};
	}

	/** Operator unlock of a brute-force-locked end-user account. */
	async unlockUser(
		id: string,
		actor: { id: string; username: string },
		clientIp: string,
	): Promise<UnlockAccountResponseDto> {
		const detail = await this.store.getUserWithMemberships(id);
		if (!detail) {
			throw new NotFoundException('User not found');
		}
		const usernameKey = detail.user.username.trim();
		await this.accountLockout.unlock('end_user', usernameKey);
		this.protectionAudit.logAccountUnlocked(
			'end_user',
			usernameKey,
			actor.id,
			actor.username,
			clientIp,
		);
		return { ok: true, id };
	}

	async getUserById(id: string, auditLimitRaw?: number): Promise<IdentityUserDetailResponseDto> {
		const detail = await this.store.getUserWithMemberships(id);
		if (!detail) {
			throw new NotFoundException('User not found');
		}

		const auditLimit = this.parseAuditLimit(auditLimitRaw);
		const recentAudit =
			auditLimit > 0 ? await this.loadRecentAudit('user', id, auditLimit) : undefined;
		const source = await this.buildUserSource(detail.user.apiConnectionId);
		const lockoutStatus = await this.accountLockout.getStatus(
			'end_user',
			detail.user.username.trim(),
		);

		return {
			user: {
				...this.toUserListItem(detail.user),
				lockout: toAccountLockoutStatusDto(lockoutStatus),
			},
			groups: detail.groups
				.map((g) => ({ id: g.id, name: g.name, origin: toOriginLiteral(g.origin) }))
				.sort((a, b) => a.name.localeCompare(b.name)),
			roles: detail.roles
				.map((r) => ({ id: r.id, name: r.name, origin: toOriginLiteral(r.origin) }))
				.sort((a, b) => a.name.localeCompare(b.name)),
			source,
			recentAudit,
		};
	}

	async createUser(body: CreateManualIdentityUserDto): Promise<IdentityUserDetailResponseDto> {
		if (body.password !== body.confirmPassword) {
			throw new BadRequestException('Passwords do not match');
		}
		const local = await this.getLocalConnection();
		await this.assertUsernameAvailable(body.username);
		const email = this.normalizeEmail(body.email);
		const passwordHash = await hashPassword(body.password);
		const groupIds = body.groupIds ?? [];
		const roleIds = body.roleIds ?? [];
		await this.validateMembershipIds(groupIds, roleIds, local.id);

		const user = await this.store.createManualUser({
			apiConnectionId: local.id,
			username: body.username.trim(),
			email,
			displayName: body.displayName?.trim() || null,
			passwordHash,
			passwordHashAlgorithm: 'bcrypt',
			active: body.active ?? true,
			groupIds,
			roleIds,
		});

		this.audit.logUserCreated(user.id, user.username);
		return this.getUserById(user.id, 0);
	}

	async updateUser(
		id: string,
		body: UpdateManualIdentityUserDto,
	): Promise<IdentityUserDetailResponseDto> {
		const existing = await this.findManualUserOrThrow(id);
		if (body.username !== undefined) {
			await this.assertUsernameAvailable(body.username, id);
		}
		const email = body.email !== undefined ? this.normalizeEmail(body.email) : undefined;
		if (body.groupIds !== undefined) {
			await this.validateMembershipIds(body.groupIds, [], existing.apiConnectionId);
		}
		if (body.roleIds !== undefined) {
			await this.validateMembershipIds([], body.roleIds, existing.apiConnectionId);
		}

		// Group/role membership changes intentionally do NOT terminate live SSO sessions: SAML assertions
		// are point-in-time snapshots, so an already-issued assertion keeps the old entitlements until the
		// session expires; the next login picks up the new memberships. Only deactivation kills sessions.
		await this.store.updateManualUser(id, {
			username: body.username !== undefined ? body.username.trim() : undefined,
			email,
			displayName: body.displayName !== undefined ? body.displayName?.trim() || null : undefined,
			active: body.active,
			passwordHash:
				body.password !== undefined && body.password.length > 0
					? await hashPassword(body.password)
					: undefined,
			groupIds: body.groupIds,
			roleIds: body.roleIds,
		});

		this.audit.logUserUpdated(id, body.username ?? existing.username);
		// SLO (v1.8.0): deactivating a user kills their live SSO sessions immediately.
		if (body.active === false && existing.active) {
			await this.ssoSessions.terminateAllForUser(id, 'user_deactivated');
		}
		return this.getUserById(id, 0);
	}

	async deleteUser(id: string): Promise<void> {
		const existing = await this.findManualUserOrThrow(id);
		await this.ssoSessions.terminateAllForUser(id, 'user_deleted');
		await this.store.deleteUser(id);
		this.audit.logUserDeleted(id, existing.username);
	}

	async listGroups(
		limitRaw?: number,
		offsetRaw?: number,
		originFilter?: string,
		apiConnectionId?: string,
	): Promise<IdentityGroupListResponseDto> {
		const limit = this.parseLimit(limitRaw);
		const offset = this.parseOffset(offsetRaw);
		const { items, total } = await this.store.listGroups({
			limit,
			offset,
			origin: this.parseOrigin(originFilter),
			apiConnectionId: this.parseApiConnectionId(apiConnectionId),
		});
		return {
			items: items.map((row) => ({
				id: row.id,
				name: row.name,
				externalId: row.externalId,
				apiConnectionId: row.apiConnectionId,
				origin: toOriginLiteral(row.origin),
				memberCount: row.memberCount,
			})),
			total,
			sources: await this.listSourceOptions(),
		};
	}

	async getGroupById(id: string): Promise<IdentityGroupDetailResponseDto> {
		const group = await this.store.getGroupById(id);
		if (!group) {
			throw new NotFoundException('Group not found');
		}
		const members = await this.store.getGroupMembers(id, MAX_MEMBERS);
		return {
			group: {
				id: group.id,
				name: group.name,
				externalId: group.externalId,
				apiConnectionId: group.apiConnectionId,
				origin: toOriginLiteral(group.origin),
				memberCount: group.memberCount,
			},
			members: members.map((m) => ({
				id: m.id,
				username: m.username,
				origin: toOriginLiteral(m.origin),
			})),
			memberCount: group.memberCount,
		};
	}

	async createGroup(body: CreateManualIdentityGroupDto): Promise<IdentityGroupDetailResponseDto> {
		const local = await this.getLocalConnection();
		const name = body.name.trim();
		await this.assertGroupNameAvailable(local.id, name);
		const group = await this.store.createManualGroup(local.id, name);
		this.audit.logGroupCreated(group.id, group.name);
		return this.getGroupById(group.id);
	}

	async updateGroup(
		id: string,
		body: UpdateManualIdentityGroupDto,
	): Promise<IdentityGroupDetailResponseDto> {
		const existing = await this.findManualGroupOrThrow(id);
		const name = body.name.trim();
		await this.assertGroupNameAvailable(existing.apiConnectionId, name, id);
		await this.store.updateGroupName(id, name);
		this.audit.logGroupUpdated(id, name);
		return this.getGroupById(id);
	}

	async deleteGroup(id: string): Promise<void> {
		const existing = await this.findManualGroupOrThrow(id);
		const memberCount = await this.store.groupMemberCount(id);
		if (memberCount > 0) {
			throw new ConflictException(`Cannot delete group: ${memberCount} user(s) still assigned`);
		}
		await this.store.deleteGroup(id);
		this.audit.logGroupDeleted(id, existing.name);
	}

	async listRoles(
		limitRaw?: number,
		offsetRaw?: number,
		originFilter?: string,
		apiConnectionId?: string,
	): Promise<IdentityRoleListResponseDto> {
		const limit = this.parseLimit(limitRaw);
		const offset = this.parseOffset(offsetRaw);
		const { items, total } = await this.store.listRoles({
			limit,
			offset,
			origin: this.parseOrigin(originFilter),
			apiConnectionId: this.parseApiConnectionId(apiConnectionId),
		});
		return {
			items: items.map((row) => ({
				id: row.id,
				name: row.name,
				externalId: row.externalId,
				apiConnectionId: row.apiConnectionId,
				origin: toOriginLiteral(row.origin),
				memberCount: row.memberCount,
			})),
			total,
			sources: await this.listSourceOptions(),
		};
	}

	async getRoleById(id: string): Promise<IdentityRoleDetailResponseDto> {
		const role = await this.store.getRoleById(id);
		if (!role) {
			throw new NotFoundException('Role not found');
		}
		const members = await this.store.getRoleMembers(id, MAX_MEMBERS);
		return {
			role: {
				id: role.id,
				name: role.name,
				externalId: role.externalId,
				apiConnectionId: role.apiConnectionId,
				origin: toOriginLiteral(role.origin),
				memberCount: role.memberCount,
			},
			members: members.map((m) => ({
				id: m.id,
				username: m.username,
				origin: toOriginLiteral(m.origin),
			})),
			memberCount: role.memberCount,
		};
	}

	async createRole(body: CreateManualIdentityRoleDto): Promise<IdentityRoleDetailResponseDto> {
		const local = await this.getLocalConnection();
		const name = body.name.trim();
		await this.assertRoleNameAvailable(local.id, name);
		const role = await this.store.createManualRole(local.id, name);
		this.audit.logRoleCreated(role.id, role.name);
		return this.getRoleById(role.id);
	}

	async updateRole(
		id: string,
		body: UpdateManualIdentityRoleDto,
	): Promise<IdentityRoleDetailResponseDto> {
		const existing = await this.findManualRoleOrThrow(id);
		const name = body.name.trim();
		await this.assertRoleNameAvailable(existing.apiConnectionId, name, id);
		await this.store.updateRoleName(id, name);
		this.audit.logRoleUpdated(id, name);
		return this.getRoleById(id);
	}

	async deleteRole(id: string): Promise<void> {
		const existing = await this.findManualRoleOrThrow(id);
		const memberCount = await this.store.roleMemberCount(id);
		if (memberCount > 0) {
			throw new ConflictException(`Cannot delete role: ${memberCount} user(s) still assigned`);
		}
		await this.store.deleteRole(id);
		this.audit.logRoleDeleted(id, existing.name);
	}

	private toUserListItem(row: StoreUser) {
		return {
			id: row.id,
			username: row.username,
			email: row.email,
			displayName: row.displayName,
			active: row.active,
			externalId: row.externalId,
			apiConnectionId: row.apiConnectionId,
			origin: toOriginLiteral(row.origin),
		};
	}

	private async buildUserSource(apiConnectionId: string) {
		const connection = await this.prisma.apiConnection.findUnique({
			where: { id: apiConnectionId },
			select: { id: true, name: true, isLocalDirectory: true },
		});
		if (connection?.isLocalDirectory) {
			return {
				kind: 'local_directory' as const,
				label: LOCAL_DIRECTORY_CONNECTION_NAME,
				apiConnectionId: connection.id,
				apiConnectionRoute: null,
			};
		}
		return {
			kind: 'api_connection' as const,
			label: connection?.name ?? '',
			apiConnectionId,
			apiConnectionRoute: apiConnectionAdminRoute(apiConnectionId),
		};
	}

	private async getLocalConnection() {
		return ensureLocalDirectoryConnection(this.prisma, (plain) => this.encryption.encrypt(plain));
	}

	/** Source options (connections + Local directory) for list responses + the Source filter (Prompt 37). */
	async listSourceOptions(): Promise<IdentitySourceOptionDto[]> {
		const rows = await this.prisma.apiConnection.findMany({
			select: { id: true, name: true, isLocalDirectory: true },
			orderBy: [{ isLocalDirectory: 'asc' }, { name: 'asc' }],
		});
		return rows.map((c) => ({
			apiConnectionId: c.id,
			label: c.isLocalDirectory ? LOCAL_DIRECTORY_CONNECTION_NAME : c.name,
			isLocalDirectory: c.isLocalDirectory,
		}));
	}

	private async findManualUserOrThrow(id: string): Promise<StoreUser> {
		const row = await this.store.getUserById(id);
		if (!row) {
			throw new NotFoundException('User not found');
		}
		if (row.origin !== IdentityOrigin.MANUAL) {
			throw new ForbiddenException('managed_by_sync');
		}
		return row;
	}

	private async findManualGroupOrThrow(id: string): Promise<StoreGroup> {
		const row = await this.store.getGroupById(id);
		if (!row) {
			throw new NotFoundException('Group not found');
		}
		if (row.origin !== IdentityOrigin.MANUAL) {
			throw new ForbiddenException('managed_by_sync');
		}
		return row;
	}

	private async findManualRoleOrThrow(id: string): Promise<StoreRole> {
		const row = await this.store.getRoleById(id);
		if (!row) {
			throw new NotFoundException('Role not found');
		}
		if (row.origin !== IdentityOrigin.MANUAL) {
			throw new ForbiddenException('managed_by_sync');
		}
		return row;
	}

	private normalizeEmail(raw: string | null | undefined): string | null {
		if (raw === undefined) {
			return null;
		}
		if (raw === null || raw === '') {
			return null;
		}
		try {
			return normalizeSyncedEmail(raw);
		} catch {
			throw new BadRequestException('Invalid email');
		}
	}

	private async assertUsernameAvailable(username: string, excludeId?: string): Promise<void> {
		if (await this.store.isUsernameTaken(username.trim(), excludeId)) {
			throw new ConflictException('Username already in use');
		}
	}

	private async assertGroupNameAvailable(
		apiConnectionId: string,
		name: string,
		excludeId?: string,
	): Promise<void> {
		if (await this.store.isGroupNameTaken(apiConnectionId, name, excludeId)) {
			throw new ConflictException('Group name already in use');
		}
	}

	private async assertRoleNameAvailable(
		apiConnectionId: string,
		name: string,
		excludeId?: string,
	): Promise<void> {
		if (await this.store.isRoleNameTaken(apiConnectionId, name, excludeId)) {
			throw new ConflictException('Role name already in use');
		}
	}

	private async validateMembershipIds(
		groupIds: string[],
		roleIds: string[],
		apiConnectionId: string,
	): Promise<void> {
		if (groupIds.length > 0 && !(await this.store.groupsExistAll(groupIds))) {
			throw new BadRequestException('Invalid group id');
		}
		if (roleIds.length > 0 && !(await this.store.rolesExistAll(roleIds))) {
			throw new BadRequestException('Invalid role id');
		}
		// Membership-within-source invariant (Prompt 37): a user may only join its own source's groups/roles.
		if (
			groupIds.length > 0 &&
			!(await this.store.groupsAllInConnection(groupIds, apiConnectionId))
		) {
			throw new BadRequestException('Group belongs to a different identity source');
		}
		if (roleIds.length > 0 && !(await this.store.rolesAllInConnection(roleIds, apiConnectionId))) {
			throw new BadRequestException('Role belongs to a different identity source');
		}
	}

	private async loadRecentAudit(subjectType: string, subjectId: string, limit: number) {
		try {
			const rows = await this.prisma.auditEvent.findMany({
				where: { category: 'identity', subjectType, subjectId },
				orderBy: { createdAt: 'desc' },
				take: limit,
				select: { id: true, event: true, createdAt: true, actorLabel: true },
			});
			return rows.map((row) => ({
				id: row.id,
				event: row.event,
				createdAt: row.createdAt.toISOString(),
				actorLabel: row.actorLabel,
			}));
		} catch {
			return undefined;
		}
	}

	/** Source filter: empty/absent means "all"; anything else must be a cuid (garbage → 400, not an empty page). */
	private parseApiConnectionId(value?: string): string | undefined {
		if (!value) {
			return undefined;
		}
		if (!isCuid(value)) {
			throw new BadRequestException('Invalid apiConnectionId');
		}
		return value;
	}

	private parseOrigin(originFilter?: string): IdentityOrigin | undefined {
		if (originFilter === 'manual') {
			return IdentityOrigin.MANUAL;
		}
		if (originFilter === 'synced') {
			return IdentityOrigin.SYNCED;
		}
		return undefined;
	}

	private parseLimit(value: number | undefined): number {
		if (value === undefined) {
			return DEFAULT_LIMIT;
		}
		if (!Number.isFinite(value) || value < 1 || value > MAX_LIMIT) {
			throw new BadRequestException(`limit must be between 1 and ${MAX_LIMIT}`);
		}
		return Math.floor(value);
	}

	private parseOffset(value: number | undefined): number {
		if (value === undefined) {
			return 0;
		}
		if (!Number.isFinite(value) || value < 0) {
			throw new BadRequestException('offset must be a non-negative number');
		}
		return Math.floor(value);
	}

	private parseAuditLimit(value: number | undefined): number {
		if (value === undefined) {
			return 0;
		}
		if (!Number.isFinite(value) || value < 0 || value > MAX_AUDIT_LIMIT) {
			throw new BadRequestException(`auditLimit must be between 0 and ${MAX_AUDIT_LIMIT}`);
		}
		return Math.floor(value);
	}
}
