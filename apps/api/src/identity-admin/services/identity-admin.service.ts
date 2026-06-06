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
	IdentityUserDetailResponseDto,
	IdentityUserListResponseDto,
	UpdateManualIdentityGroupDto,
	UpdateManualIdentityRoleDto,
	UpdateManualIdentityUserDto,
} from '@nestidp/shared';
import { LOCAL_DIRECTORY_CONNECTION_NAME, apiConnectionAdminRoute } from '@nestidp/shared';
import { IdentityOrigin, Prisma } from '@prisma/client';
import { hashPassword } from '../../admin-auth/utils/password.util';
import {
	CREDENTIALS_ENCRYPTION,
	type CredentialsEncryptionPort,
} from '../../encryption/credentials-encryption.port';
import { normalizeSyncedEmail } from '../../identity/utils/normalize-synced-email.util';
import { IdentityRepository } from '../../identity/identity.repository';
import {
	ensureLocalDirectoryConnection,
	manualExternalId,
	toOriginLiteral,
} from '../../identity/utils/local-directory.util';
import { PrismaService } from '../../prisma/services/prisma.service';
import { SamlSsoSessionService } from '../../saml-sessions/services/saml-sso-session.service';
import { IdentityAdminAuditService } from './identity-admin-audit.service';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_AUDIT_LIMIT = 20;
const MAX_MEMBERS = 500;

@Injectable()
export class IdentityAdminService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly identityRepository: IdentityRepository,
		@Inject(CREDENTIALS_ENCRYPTION)
		private readonly encryption: CredentialsEncryptionPort,
		private readonly audit: IdentityAdminAuditService,
		private readonly ssoSessions: SamlSsoSessionService,
	) {}

	async listUsers(
		limitRaw?: number,
		offsetRaw?: number,
		search?: string,
		originFilter?: string,
	): Promise<IdentityUserListResponseDto> {
		const limit = this.parseLimit(limitRaw);
		const offset = this.parseOffset(offsetRaw);
		const where: Prisma.UserWhereInput = {
			...this.buildUserSearchWhere(search),
			...this.buildUserOriginWhere(originFilter),
		};

		const [rows, total] = await Promise.all([
			this.prisma.user.findMany({
				where,
				orderBy: { username: 'asc' },
				skip: offset,
				take: limit,
				select: this.userListSelect(),
			}),
			this.prisma.user.count({ where }),
		]);

		return { items: rows.map((row) => this.toUserListItem(row)), total };
	}

	async getUserById(id: string, auditLimitRaw?: number): Promise<IdentityUserDetailResponseDto> {
		const row = await this.prisma.user.findUnique({
			where: { id },
			select: {
				...this.userListSelect(),
				groups: {
					select: { group: { select: { id: true, name: true, origin: true } } },
				},
				roles: {
					select: { role: { select: { id: true, name: true, origin: true } } },
				},
				apiConnection: { select: { id: true, name: true, isLocalDirectory: true } },
			},
		});

		if (!row) {
			throw new NotFoundException('User not found');
		}

		const auditLimit = this.parseAuditLimit(auditLimitRaw);
		const recentAudit =
			auditLimit > 0 ? await this.loadRecentAudit('user', id, auditLimit) : undefined;

		return {
			user: this.toUserListItem(row),
			groups: row.groups
				.map((g) => ({
					id: g.group.id,
					name: g.group.name,
					origin: toOriginLiteral(g.group.origin),
				}))
				.sort((a, b) => a.name.localeCompare(b.name)),
			roles: row.roles
				.map((r) => ({
					id: r.role.id,
					name: r.role.name,
					origin: toOriginLiteral(r.role.origin),
				}))
				.sort((a, b) => a.name.localeCompare(b.name)),
			source: this.buildUserSource(row.apiConnection),
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
		await this.validateMembershipIds(groupIds, roleIds);

		const user = await this.prisma.$transaction(async (tx) => {
			const created = await tx.user.create({
				data: {
					apiConnectionId: local.id,
					origin: IdentityOrigin.MANUAL,
					externalId: 'manual:pending',
					username: body.username.trim(),
					email,
					displayName: body.displayName?.trim() || null,
					passwordHash,
					passwordHashAlgorithm: 'bcrypt',
					active: body.active ?? true,
				},
			});
			await tx.user.update({
				where: { id: created.id },
				data: { externalId: manualExternalId('user', created.id) },
			});
			if (groupIds.length > 0) {
				await tx.userGroup.createMany({
					data: groupIds.map((groupId) => ({ userId: created.id, groupId })),
				});
			}
			if (roleIds.length > 0) {
				await tx.userRole.createMany({
					data: roleIds.map((roleId) => ({ userId: created.id, roleId })),
				});
			}
			return created;
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
		const data: Prisma.UserUpdateInput = {};
		if (body.username !== undefined) {
			data.username = body.username.trim();
		}
		if (email !== undefined) {
			data.email = email;
		}
		if (body.displayName !== undefined) {
			data.displayName = body.displayName?.trim() || null;
		}
		if (body.active !== undefined) {
			data.active = body.active;
		}
		if (body.password !== undefined && body.password.length > 0) {
			data.passwordHash = await hashPassword(body.password);
		}
		if (body.groupIds !== undefined) {
			await this.validateMembershipIds(body.groupIds, []);
		}
		if (body.roleIds !== undefined) {
			await this.validateMembershipIds([], body.roleIds);
		}

		await this.prisma.$transaction(async (tx) => {
			await tx.user.update({ where: { id }, data });
			if (body.groupIds !== undefined) {
				await tx.userGroup.deleteMany({ where: { userId: id } });
				if (body.groupIds.length > 0) {
					await tx.userGroup.createMany({
						data: body.groupIds.map((groupId) => ({ userId: id, groupId })),
					});
				}
			}
			if (body.roleIds !== undefined) {
				await tx.userRole.deleteMany({ where: { userId: id } });
				if (body.roleIds.length > 0) {
					await tx.userRole.createMany({
						data: body.roleIds.map((roleId) => ({ userId: id, roleId })),
					});
				}
			}
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
		await this.ssoSessions.terminateAllForUser(id, 'user_deactivated');
		await this.prisma.user.delete({ where: { id } });
		this.audit.logUserDeleted(id, existing.username);
	}

	async listGroups(
		limitRaw?: number,
		offsetRaw?: number,
		originFilter?: string,
	): Promise<IdentityGroupListResponseDto> {
		const limit = this.parseLimit(limitRaw);
		const offset = this.parseOffset(offsetRaw);
		const where = this.buildGroupOriginWhere(originFilter);

		const [rows, total] = await Promise.all([
			this.prisma.group.findMany({
				where,
				orderBy: { name: 'asc' },
				skip: offset,
				take: limit,
				select: {
					id: true,
					name: true,
					externalId: true,
					apiConnectionId: true,
					origin: true,
					_count: { select: { users: true } },
				},
			}),
			this.prisma.group.count({ where }),
		]);

		return {
			items: rows.map((row) => ({
				id: row.id,
				name: row.name,
				externalId: row.externalId,
				apiConnectionId: row.apiConnectionId,
				origin: toOriginLiteral(row.origin),
				memberCount: row._count.users,
			})),
			total,
		};
	}

	async getGroupById(id: string): Promise<IdentityGroupDetailResponseDto> {
		const group = await this.prisma.group.findUnique({
			where: { id },
			select: {
				id: true,
				name: true,
				externalId: true,
				apiConnectionId: true,
				origin: true,
				_count: { select: { users: true } },
			},
		});
		if (!group) {
			throw new NotFoundException('Group not found');
		}
		const members = await this.loadGroupMembers(id);
		return {
			group: {
				id: group.id,
				name: group.name,
				externalId: group.externalId,
				apiConnectionId: group.apiConnectionId,
				origin: toOriginLiteral(group.origin),
				memberCount: group._count.users,
			},
			members,
			memberCount: group._count.users,
		};
	}

	async createGroup(body: CreateManualIdentityGroupDto): Promise<IdentityGroupDetailResponseDto> {
		const local = await this.getLocalConnection();
		const name = body.name.trim();
		await this.assertGroupNameAvailable(local.id, name);

		const group = await this.prisma.$transaction(async (tx) => {
			const created = await tx.group.create({
				data: {
					apiConnectionId: local.id,
					origin: IdentityOrigin.MANUAL,
					externalId: 'manual:pending',
					name,
				},
			});
			return tx.group.update({
				where: { id: created.id },
				data: { externalId: manualExternalId('group', created.id) },
			});
		});

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
		const group = await this.prisma.group.update({
			where: { id },
			data: { name },
		});
		this.audit.logGroupUpdated(id, group.name);
		return this.getGroupById(id);
	}

	async deleteGroup(id: string): Promise<void> {
		const existing = await this.findManualGroupOrThrow(id);
		const memberCount = await this.prisma.userGroup.count({ where: { groupId: id } });
		if (memberCount > 0) {
			throw new ConflictException(`Cannot delete group: ${memberCount} user(s) still assigned`);
		}
		await this.prisma.group.delete({ where: { id } });
		this.audit.logGroupDeleted(id, existing.name);
	}

	async listRoles(
		limitRaw?: number,
		offsetRaw?: number,
		originFilter?: string,
	): Promise<IdentityRoleListResponseDto> {
		const limit = this.parseLimit(limitRaw);
		const offset = this.parseOffset(offsetRaw);
		const where = this.buildRoleOriginWhere(originFilter);

		const [rows, total] = await Promise.all([
			this.prisma.role.findMany({
				where,
				orderBy: { name: 'asc' },
				skip: offset,
				take: limit,
				select: {
					id: true,
					name: true,
					externalId: true,
					apiConnectionId: true,
					origin: true,
					_count: { select: { users: true } },
				},
			}),
			this.prisma.role.count({ where }),
		]);

		return {
			items: rows.map((row) => ({
				id: row.id,
				name: row.name,
				externalId: row.externalId,
				apiConnectionId: row.apiConnectionId,
				origin: toOriginLiteral(row.origin),
				memberCount: row._count.users,
			})),
			total,
		};
	}

	async getRoleById(id: string): Promise<IdentityRoleDetailResponseDto> {
		const role = await this.prisma.role.findUnique({
			where: { id },
			select: {
				id: true,
				name: true,
				externalId: true,
				apiConnectionId: true,
				origin: true,
				_count: { select: { users: true } },
			},
		});
		if (!role) {
			throw new NotFoundException('Role not found');
		}
		const members = await this.loadRoleMembers(id);
		return {
			role: {
				id: role.id,
				name: role.name,
				externalId: role.externalId,
				apiConnectionId: role.apiConnectionId,
				origin: toOriginLiteral(role.origin),
				memberCount: role._count.users,
			},
			members,
			memberCount: role._count.users,
		};
	}

	async createRole(body: CreateManualIdentityRoleDto): Promise<IdentityRoleDetailResponseDto> {
		const local = await this.getLocalConnection();
		const name = body.name.trim();
		await this.assertRoleNameAvailable(local.id, name);

		const role = await this.prisma.$transaction(async (tx) => {
			const created = await tx.role.create({
				data: {
					apiConnectionId: local.id,
					origin: IdentityOrigin.MANUAL,
					externalId: 'manual:pending',
					name,
				},
			});
			return tx.role.update({
				where: { id: created.id },
				data: { externalId: manualExternalId('role', created.id) },
			});
		});

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
		const role = await this.prisma.role.update({
			where: { id },
			data: { name },
		});
		this.audit.logRoleUpdated(id, role.name);
		return this.getRoleById(id);
	}

	async deleteRole(id: string): Promise<void> {
		const existing = await this.findManualRoleOrThrow(id);
		const memberCount = await this.prisma.userRole.count({ where: { roleId: id } });
		if (memberCount > 0) {
			throw new ConflictException(`Cannot delete role: ${memberCount} user(s) still assigned`);
		}
		await this.prisma.role.delete({ where: { id } });
		this.audit.logRoleDeleted(id, existing.name);
	}

	private userListSelect() {
		return {
			id: true,
			username: true,
			email: true,
			displayName: true,
			active: true,
			externalId: true,
			apiConnectionId: true,
			origin: true,
		} as const;
	}

	private toUserListItem(row: {
		id: string;
		username: string;
		email: string | null;
		displayName: string | null;
		active: boolean;
		externalId: string;
		apiConnectionId: string;
		origin: IdentityOrigin;
	}) {
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

	private buildUserSource(connection: { id: string; name: string; isLocalDirectory: boolean }) {
		if (connection.isLocalDirectory) {
			return {
				kind: 'local_directory' as const,
				label: LOCAL_DIRECTORY_CONNECTION_NAME,
				apiConnectionId: connection.id,
				apiConnectionRoute: null,
			};
		}
		return {
			kind: 'api_connection' as const,
			label: connection.name,
			apiConnectionId: connection.id,
			apiConnectionRoute: apiConnectionAdminRoute(connection.id),
		};
	}

	private async getLocalConnection() {
		return ensureLocalDirectoryConnection(this.prisma, (plain) => this.encryption.encrypt(plain));
	}

	private async findManualUserOrThrow(id: string) {
		const row = await this.prisma.user.findUnique({ where: { id } });
		if (!row) {
			throw new NotFoundException('User not found');
		}
		if (row.origin !== IdentityOrigin.MANUAL) {
			throw new ForbiddenException('managed_by_sync');
		}
		return row;
	}

	private async findManualGroupOrThrow(id: string) {
		const row = await this.prisma.group.findUnique({ where: { id } });
		if (!row) {
			throw new NotFoundException('Group not found');
		}
		if (row.origin !== IdentityOrigin.MANUAL) {
			throw new ForbiddenException('managed_by_sync');
		}
		return row;
	}

	private async findManualRoleOrThrow(id: string) {
		const row = await this.prisma.role.findUnique({ where: { id } });
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
		const existing = await this.prisma.user.findUnique({
			where: { username: username.trim() },
		});
		if (existing && existing.id !== excludeId) {
			throw new ConflictException('Username already in use');
		}
	}

	private async assertGroupNameAvailable(
		apiConnectionId: string,
		name: string,
		excludeId?: string,
	): Promise<void> {
		const row = await this.prisma.group.findUnique({
			where: { apiConnectionId_name: { apiConnectionId, name } },
		});
		if (row && row.id !== excludeId) {
			throw new ConflictException('Group name already in use');
		}
	}

	private async assertRoleNameAvailable(
		apiConnectionId: string,
		name: string,
		excludeId?: string,
	): Promise<void> {
		const row = await this.prisma.role.findUnique({
			where: { apiConnectionId_name: { apiConnectionId, name } },
		});
		if (row && row.id !== excludeId) {
			throw new ConflictException('Role name already in use');
		}
	}

	private async validateMembershipIds(groupIds: string[], roleIds: string[]): Promise<void> {
		if (groupIds.length > 0) {
			const count = await this.prisma.group.count({
				where: { id: { in: groupIds } },
			});
			if (count !== groupIds.length) {
				throw new BadRequestException('Invalid group id');
			}
		}
		if (roleIds.length > 0) {
			const count = await this.prisma.role.count({
				where: { id: { in: roleIds } },
			});
			if (count !== roleIds.length) {
				throw new BadRequestException('Invalid role id');
			}
		}
	}

	private async loadGroupMembers(groupId: string) {
		const rows = await this.prisma.userGroup.findMany({
			where: { groupId },
			take: MAX_MEMBERS,
			select: {
				user: { select: { id: true, username: true, origin: true } },
			},
			orderBy: { user: { username: 'asc' } },
		});
		return rows.map((row) => ({
			id: row.user.id,
			username: row.user.username,
			origin: toOriginLiteral(row.user.origin),
		}));
	}

	private async loadRoleMembers(roleId: string) {
		const rows = await this.prisma.userRole.findMany({
			where: { roleId },
			take: MAX_MEMBERS,
			select: {
				user: { select: { id: true, username: true, origin: true } },
			},
			orderBy: { user: { username: 'asc' } },
		});
		return rows.map((row) => ({
			id: row.user.id,
			username: row.user.username,
			origin: toOriginLiteral(row.user.origin),
		}));
	}

	private async loadRecentAudit(subjectType: string, subjectId: string, limit: number) {
		try {
			const rows = await this.prisma.auditEvent.findMany({
				where: {
					category: 'identity',
					subjectType,
					subjectId,
				},
				orderBy: { createdAt: 'desc' },
				take: limit,
				select: {
					id: true,
					event: true,
					createdAt: true,
					actorLabel: true,
				},
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

	private buildUserOriginWhere(originFilter?: string): Prisma.UserWhereInput {
		if (originFilter === 'manual') {
			return { origin: IdentityOrigin.MANUAL };
		}
		if (originFilter === 'synced') {
			return { origin: IdentityOrigin.SYNCED };
		}
		return {};
	}

	private buildGroupOriginWhere(originFilter?: string): Prisma.GroupWhereInput {
		if (originFilter === 'manual') {
			return { origin: IdentityOrigin.MANUAL };
		}
		if (originFilter === 'synced') {
			return { origin: IdentityOrigin.SYNCED };
		}
		return {};
	}

	private buildRoleOriginWhere(originFilter?: string): Prisma.RoleWhereInput {
		if (originFilter === 'manual') {
			return { origin: IdentityOrigin.MANUAL };
		}
		if (originFilter === 'synced') {
			return { origin: IdentityOrigin.SYNCED };
		}
		return {};
	}

	private buildUserSearchWhere(search?: string): Prisma.UserWhereInput {
		if (!search || search.trim().length === 0) {
			return {};
		}
		const term = search.trim();
		return {
			OR: [{ username: { contains: term } }, { email: { contains: term } }],
		};
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
