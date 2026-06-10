import { Injectable } from '@nestjs/common';
import { IdentityOrigin, Prisma } from '@prisma/client';
import { normalizeSyncedEmail } from './utils/normalize-synced-email.util';
import { manualExternalId } from './utils/local-directory.util';
import { PrismaService } from '../prisma/services/prisma.service';
import { AccountLockoutService } from '../auth-protection/account-lockout.service';
import type {
	CreateManualUserInput,
	IdentityCountsByConnection,
	IdentitySnapshot,
	IdentityStore,
	ImportCounts,
	ImportMode,
	ImportProgress,
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
} from './store/identity-store';

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		out.push(items.slice(i, i + size));
	}
	return out;
}

// Re-exported for backward-compatible imports across the codebase.
export type { UserProfileForAuth, UpsertUserInput } from './store/identity-store';

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

/** A membership would cross identity sources — a user may only belong to its own source's groups/roles. */
export class MembershipCrossConnectionError extends Error {
	constructor(public readonly kind: 'group' | 'role') {
		super(`Cannot assign a ${kind} from a different identity source`);
		this.name = 'MembershipCrossConnectionError';
	}
}

/** Local (libSQL/Prisma) implementation of {@link IdentityStore}. */
@Injectable()
export class IdentityRepository implements IdentityStore {
	constructor(
		private readonly prisma: PrismaService,
		// Optional so unit tests can `new IdentityRepository(prisma)`; Nest injects it in production via
		// AuthProtectionModule. Used only to clear a stale lockout when an upstream credential rotates.
		private readonly accountLockout?: AccountLockoutService,
	) {}

	countUsers(): Promise<number> {
		return this.prisma.user.count();
	}

	countGroups(): Promise<number> {
		return this.prisma.group.count();
	}

	countRoles(): Promise<number> {
		return this.prisma.role.count();
	}

	async countsByConnection(): Promise<IdentityCountsByConnection> {
		const [users, groups, roles] = await Promise.all([
			this.prisma.user.groupBy({ by: ['apiConnectionId'], _count: { _all: true } }),
			this.prisma.group.groupBy({ by: ['apiConnectionId'], _count: { _all: true } }),
			this.prisma.role.groupBy({ by: ['apiConnectionId'], _count: { _all: true } }),
		]);
		const toRecord = (rows: { apiConnectionId: string; _count: { _all: number } }[]) =>
			Object.fromEntries(rows.map((r) => [r.apiConnectionId, r._count._all]));
		return { users: toRecord(users), groups: toRecord(groups), roles: toRecord(roles) };
	}

	findUserByUsername(username: string): Promise<StoreUser | null> {
		return this.prisma.user.findUnique({ where: { username } });
	}

	async findUserProfileById(userId: string): Promise<UserProfileForAuth | null> {
		const row = await this.prisma.user.findUnique({
			where: { id: userId },
			select: {
				id: true,
				username: true,
				email: true,
				displayName: true,
				active: true,
				groups: {
					select: { group: { select: { name: true } } },
				},
				roles: {
					select: { role: { select: { name: true } } },
				},
			},
		});
		if (!row) {
			return null;
		}
		return {
			id: row.id,
			username: row.username,
			email: row.email,
			displayName: row.displayName,
			active: row.active,
			groups: row.groups.map((ug) => ug.group.name),
			roles: row.roles.map((ur) => ur.role.name),
		};
	}

	async upsertUser(connectionId: string, user: UpsertUserInput): Promise<StoreUser> {
		const existingByUsername = await this.prisma.user.findUnique({
			where: { username: user.username },
		});
		if (
			existingByUsername &&
			(existingByUsername.apiConnectionId !== connectionId ||
				existingByUsername.externalId !== user.externalId)
		) {
			throw new UsernameCollisionError(user.externalId, user.username);
		}

		let email = user.email;
		if (email != null) {
			try {
				email = normalizeSyncedEmail(email);
			} catch {
				email = null;
			}
		}

		const existing = await this.prisma.user.findUnique({
			where: {
				apiConnectionId_externalId: {
					apiConnectionId: connectionId,
					externalId: user.externalId,
				},
			},
		});
		if (existing?.origin === IdentityOrigin.MANUAL) {
			throw new UsernameCollisionError(user.externalId, user.username);
		}

		let row: StoreUser;
		try {
			row = await this.prisma.user.upsert({
				where: {
					apiConnectionId_externalId: {
						apiConnectionId: connectionId,
						externalId: user.externalId,
					},
				},
				create: {
					apiConnectionId: connectionId,
					origin: IdentityOrigin.SYNCED,
					externalId: user.externalId,
					username: user.username,
					email,
					displayName: user.displayName,
					passwordHash: user.passwordHash,
					passwordHashAlgorithm: user.passwordHashAlgorithm,
					active: user.active,
				},
				update: {
					username: user.username,
					email,
					displayName: user.displayName,
					passwordHash: user.passwordHash,
					passwordHashAlgorithm: user.passwordHashAlgorithm,
					active: user.active,
				},
			});
		} catch (error) {
			// Concurrency race (Prompt 37): the read-then-write check above can be raced by a concurrent
			// sync of another connection. The `username` global @unique is the final arbiter — convert the
			// P2002 into the same collision outcome so exactly one user persists and the loser is reported.
			if (
				error instanceof Prisma.PrismaClientKnownRequestError &&
				error.code === 'P2002' &&
				(error.meta?.target as string[] | string | undefined)?.includes('username')
			) {
				throw new UsernameCollisionError(user.externalId, user.username);
			}
			throw error;
		}
		// Credential rotated upstream (new hash) → clear any brute-force lockout for this account so the
		// legitimate user is not stuck behind a stale lock (Prompt 35). `existingByUsername` is the prior
		// row for this same identity; comparing its hash is free (already fetched above).
		if (existingByUsername && existingByUsername.passwordHash !== user.passwordHash) {
			await this.accountLockout?.recordSuccess('end_user', user.username.trim());
		}
		return row;
	}

	async replaceUserGroups(userId: string, groupIds: string[]): Promise<void> {
		await this.assertMembershipsSameConnection(userId, 'group', groupIds);
		await this.prisma.$transaction(async (tx) => {
			await tx.userGroup.deleteMany({ where: { userId } });
			if (groupIds.length > 0) {
				await tx.userGroup.createMany({
					data: groupIds.map((groupId) => ({ userId, groupId })),
				});
			}
		});
	}

	async replaceUserRoles(userId: string, roleIds: string[]): Promise<void> {
		await this.assertMembershipsSameConnection(userId, 'role', roleIds);
		await this.prisma.$transaction(async (tx) => {
			await tx.userRole.deleteMany({ where: { userId } });
			if (roleIds.length > 0) {
				await tx.userRole.createMany({
					data: roleIds.map((roleId) => ({ userId, roleId })),
				});
			}
		});
	}

	/**
	 * Membership-within-source invariant (Prompt 37): a user may only be a member of groups/roles that
	 * belong to the user's own `apiConnectionId`. Defensive — sync already passes same-source ids; this
	 * blocks a cross-connection assignment (e.g. via a buggy/manual path). Throws
	 * {@link MembershipCrossConnectionError} on a mismatch.
	 */
	private async assertMembershipsSameConnection(
		userId: string,
		kind: 'group' | 'role',
		ids: string[],
	): Promise<void> {
		if (ids.length === 0) {
			return;
		}
		const user = await this.prisma.user.findUnique({
			where: { id: userId },
			select: { apiConnectionId: true },
		});
		if (!user) {
			return;
		}
		const foreign =
			kind === 'group'
				? await this.prisma.group.count({
						where: { id: { in: ids }, apiConnectionId: { not: user.apiConnectionId } },
					})
				: await this.prisma.role.count({
						where: { id: { in: ids }, apiConnectionId: { not: user.apiConnectionId } },
					});
		if (foreign > 0) {
			throw new MembershipCrossConnectionError(kind);
		}
	}

	async upsertGroup(
		connectionId: string,
		externalGroup: { id: string; name: string },
	): Promise<StoreGroup> {
		try {
			return await this.prisma.group.upsert({
				where: {
					apiConnectionId_externalId: {
						apiConnectionId: connectionId,
						externalId: externalGroup.id,
					},
				},
				create: {
					apiConnectionId: connectionId,
					origin: IdentityOrigin.SYNCED,
					externalId: externalGroup.id,
					name: externalGroup.name,
				},
				update: {
					name: externalGroup.name,
				},
			});
		} catch (error) {
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
				throw new GroupNameCollisionError(externalGroup.id, externalGroup.name);
			}
			throw error;
		}
	}

	async upsertRole(
		connectionId: string,
		externalRole: { id: string; name: string },
	): Promise<StoreRole> {
		try {
			return await this.prisma.role.upsert({
				where: {
					apiConnectionId_externalId: {
						apiConnectionId: connectionId,
						externalId: externalRole.id,
					},
				},
				create: {
					apiConnectionId: connectionId,
					origin: IdentityOrigin.SYNCED,
					externalId: externalRole.id,
					name: externalRole.name,
				},
				update: {
					name: externalRole.name,
				},
			});
		} catch (error) {
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
				throw new RoleNameCollisionError(externalRole.id, externalRole.name);
			}
			throw error;
		}
	}

	async deactivateUsersNotInExternalIds(
		connectionId: string,
		externalIds: Set<string>,
	): Promise<number> {
		const usersToDeactivate = await this.prisma.user.findMany({
			where: {
				apiConnectionId: connectionId,
				origin: IdentityOrigin.SYNCED,
				externalId: { notIn: Array.from(externalIds) },
				active: true,
			},
		});

		for (const user of usersToDeactivate) {
			await this.prisma.$transaction([
				this.prisma.userGroup.deleteMany({ where: { userId: user.id } }),
				this.prisma.userRole.deleteMany({ where: { userId: user.id } }),
				this.prisma.user.update({
					where: { id: user.id },
					data: { active: false },
				}),
			]);
		}

		return usersToDeactivate.length;
	}

	async deleteOrphanGroups(connectionId: string, seenExternalIds: Set<string>): Promise<number> {
		const result = await this.prisma.group.deleteMany({
			where: {
				apiConnectionId: connectionId,
				origin: IdentityOrigin.SYNCED,
				externalId: { notIn: Array.from(seenExternalIds) },
			},
		});
		return result.count;
	}

	async deleteOrphanRoles(connectionId: string, seenExternalIds: Set<string>): Promise<number> {
		const result = await this.prisma.role.deleteMany({
			where: {
				apiConnectionId: connectionId,
				origin: IdentityOrigin.SYNCED,
				externalId: { notIn: Array.from(seenExternalIds) },
			},
		});
		return result.count;
	}

	// --- admin: users ---

	async listUsers(query: ListQuery): Promise<ListResult<StoreUser>> {
		const where: Prisma.UserWhereInput = {
			...this.userSearchWhere(query.search),
			...(query.origin ? { origin: query.origin } : {}),
			...(query.apiConnectionId ? { apiConnectionId: query.apiConnectionId } : {}),
		};
		const [items, total] = await Promise.all([
			this.prisma.user.findMany({
				where,
				orderBy: { username: 'asc' },
				skip: query.offset,
				take: query.limit,
			}),
			this.prisma.user.count({ where }),
		]);
		return { items, total };
	}

	getUserById(id: string): Promise<StoreUser | null> {
		return this.prisma.user.findUnique({ where: { id } });
	}

	async getUserWithMemberships(id: string): Promise<UserWithMemberships | null> {
		const row = await this.prisma.user.findUnique({
			where: { id },
			include: {
				groups: { select: { group: { select: { id: true, name: true, origin: true } } } },
				roles: { select: { role: { select: { id: true, name: true, origin: true } } } },
			},
		});
		if (!row) {
			return null;
		}
		const { groups, roles, ...user } = row;
		return {
			user,
			groups: groups.map((g) => ({ id: g.group.id, name: g.group.name, origin: g.group.origin })),
			roles: roles.map((r) => ({ id: r.role.id, name: r.role.name, origin: r.role.origin })),
		};
	}

	async createManualUser(input: CreateManualUserInput): Promise<StoreUser> {
		return this.prisma.$transaction(async (tx) => {
			const created = await tx.user.create({
				data: {
					apiConnectionId: input.apiConnectionId,
					origin: IdentityOrigin.MANUAL,
					externalId: 'manual:pending',
					username: input.username,
					email: input.email,
					displayName: input.displayName,
					passwordHash: input.passwordHash,
					passwordHashAlgorithm: input.passwordHashAlgorithm,
					active: input.active,
				},
			});
			const updated = await tx.user.update({
				where: { id: created.id },
				data: { externalId: manualExternalId('user', created.id) },
			});
			if (input.groupIds.length > 0) {
				await tx.userGroup.createMany({
					data: input.groupIds.map((groupId) => ({ userId: created.id, groupId })),
				});
			}
			if (input.roleIds.length > 0) {
				await tx.userRole.createMany({
					data: input.roleIds.map((roleId) => ({ userId: created.id, roleId })),
				});
			}
			return updated;
		});
	}

	async updateManualUser(id: string, input: UpdateManualUserInput): Promise<void> {
		const data: Prisma.UserUpdateInput = {};
		if (input.username !== undefined) {
			data.username = input.username;
		}
		if (input.email !== undefined) {
			data.email = input.email;
		}
		if (input.displayName !== undefined) {
			data.displayName = input.displayName;
		}
		if (input.active !== undefined) {
			data.active = input.active;
		}
		if (input.passwordHash !== undefined) {
			data.passwordHash = input.passwordHash;
		}
		await this.prisma.$transaction(async (tx) => {
			await tx.user.update({ where: { id }, data });
			if (input.groupIds !== undefined) {
				await tx.userGroup.deleteMany({ where: { userId: id } });
				if (input.groupIds.length > 0) {
					await tx.userGroup.createMany({
						data: input.groupIds.map((groupId) => ({ userId: id, groupId })),
					});
				}
			}
			if (input.roleIds !== undefined) {
				await tx.userRole.deleteMany({ where: { userId: id } });
				if (input.roleIds.length > 0) {
					await tx.userRole.createMany({
						data: input.roleIds.map((roleId) => ({ userId: id, roleId })),
					});
				}
			}
		});
	}

	async deleteUser(id: string): Promise<void> {
		await this.prisma.user.delete({ where: { id } });
	}

	async isUsernameTaken(username: string, excludeId?: string): Promise<boolean> {
		const existing = await this.prisma.user.findUnique({ where: { username } });
		return existing !== null && existing.id !== excludeId;
	}

	async groupsExistAll(ids: string[]): Promise<boolean> {
		if (ids.length === 0) {
			return true;
		}
		const count = await this.prisma.group.count({ where: { id: { in: ids } } });
		return count === ids.length;
	}

	async rolesExistAll(ids: string[]): Promise<boolean> {
		if (ids.length === 0) {
			return true;
		}
		const count = await this.prisma.role.count({ where: { id: { in: ids } } });
		return count === ids.length;
	}

	async groupsAllInConnection(ids: string[], apiConnectionId: string): Promise<boolean> {
		if (ids.length === 0) {
			return true;
		}
		const count = await this.prisma.group.count({ where: { id: { in: ids }, apiConnectionId } });
		return count === ids.length;
	}

	async rolesAllInConnection(ids: string[], apiConnectionId: string): Promise<boolean> {
		if (ids.length === 0) {
			return true;
		}
		const count = await this.prisma.role.count({ where: { id: { in: ids }, apiConnectionId } });
		return count === ids.length;
	}

	// --- admin: groups ---

	async listGroups(query: ListQuery): Promise<ListResult<StoreGroupWithCount>> {
		const where: Prisma.GroupWhereInput = {
			...(query.origin ? { origin: query.origin } : {}),
			...(query.apiConnectionId ? { apiConnectionId: query.apiConnectionId } : {}),
		};
		const [rows, total] = await Promise.all([
			this.prisma.group.findMany({
				where,
				orderBy: { name: 'asc' },
				skip: query.offset,
				take: query.limit,
				include: { _count: { select: { users: true } } },
			}),
			this.prisma.group.count({ where }),
		]);
		return {
			items: rows.map(({ _count, ...group }) => ({ ...group, memberCount: _count.users })),
			total,
		};
	}

	async getGroupById(id: string): Promise<StoreGroupWithCount | null> {
		const row = await this.prisma.group.findUnique({
			where: { id },
			include: { _count: { select: { users: true } } },
		});
		if (!row) {
			return null;
		}
		const { _count, ...group } = row;
		return { ...group, memberCount: _count.users };
	}

	async getGroupMembers(id: string, max: number): Promise<StoreMember[]> {
		const rows = await this.prisma.userGroup.findMany({
			where: { groupId: id },
			take: max,
			select: { user: { select: { id: true, username: true, origin: true } } },
			orderBy: { user: { username: 'asc' } },
		});
		return rows.map((row) => ({
			id: row.user.id,
			username: row.user.username,
			origin: row.user.origin,
		}));
	}

	async createManualGroup(apiConnectionId: string, name: string): Promise<StoreGroup> {
		return this.prisma.$transaction(async (tx) => {
			const created = await tx.group.create({
				data: {
					apiConnectionId,
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
	}

	async updateGroupName(id: string, name: string): Promise<void> {
		await this.prisma.group.update({ where: { id }, data: { name } });
	}

	async deleteGroup(id: string): Promise<void> {
		await this.prisma.group.delete({ where: { id } });
	}

	groupMemberCount(id: string): Promise<number> {
		return this.prisma.userGroup.count({ where: { groupId: id } });
	}

	async isGroupNameTaken(
		apiConnectionId: string,
		name: string,
		excludeId?: string,
	): Promise<boolean> {
		const row = await this.prisma.group.findUnique({
			where: { apiConnectionId_name: { apiConnectionId, name } },
		});
		return row !== null && row.id !== excludeId;
	}

	// --- admin: roles ---

	async listRoles(query: ListQuery): Promise<ListResult<StoreRoleWithCount>> {
		const where: Prisma.RoleWhereInput = {
			...(query.origin ? { origin: query.origin } : {}),
			...(query.apiConnectionId ? { apiConnectionId: query.apiConnectionId } : {}),
		};
		const [rows, total] = await Promise.all([
			this.prisma.role.findMany({
				where,
				orderBy: { name: 'asc' },
				skip: query.offset,
				take: query.limit,
				include: { _count: { select: { users: true } } },
			}),
			this.prisma.role.count({ where }),
		]);
		return {
			items: rows.map(({ _count, ...role }) => ({ ...role, memberCount: _count.users })),
			total,
		};
	}

	async getRoleById(id: string): Promise<StoreRoleWithCount | null> {
		const row = await this.prisma.role.findUnique({
			where: { id },
			include: { _count: { select: { users: true } } },
		});
		if (!row) {
			return null;
		}
		const { _count, ...role } = row;
		return { ...role, memberCount: _count.users };
	}

	async getRoleMembers(id: string, max: number): Promise<StoreMember[]> {
		const rows = await this.prisma.userRole.findMany({
			where: { roleId: id },
			take: max,
			select: { user: { select: { id: true, username: true, origin: true } } },
			orderBy: { user: { username: 'asc' } },
		});
		return rows.map((row) => ({
			id: row.user.id,
			username: row.user.username,
			origin: row.user.origin,
		}));
	}

	async createManualRole(apiConnectionId: string, name: string): Promise<StoreRole> {
		return this.prisma.$transaction(async (tx) => {
			const created = await tx.role.create({
				data: {
					apiConnectionId,
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
	}

	async updateRoleName(id: string, name: string): Promise<void> {
		await this.prisma.role.update({ where: { id }, data: { name } });
	}

	async deleteRole(id: string): Promise<void> {
		await this.prisma.role.delete({ where: { id } });
	}

	roleMemberCount(id: string): Promise<number> {
		return this.prisma.userRole.count({ where: { roleId: id } });
	}

	async isRoleNameTaken(
		apiConnectionId: string,
		name: string,
		excludeId?: string,
	): Promise<boolean> {
		const row = await this.prisma.role.findUnique({
			where: { apiConnectionId_name: { apiConnectionId, name } },
		});
		return row !== null && row.id !== excludeId;
	}

	private userSearchWhere(search?: string): Prisma.UserWhereInput {
		if (!search || search.trim().length === 0) {
			return {};
		}
		const term = search.trim();
		return { OR: [{ username: { contains: term } }, { email: { contains: term } }] };
	}

	// --- replication / migration ---

	async exportAll(): Promise<IdentitySnapshot> {
		const [users, groups, roles, userGroups, userRoles] = await Promise.all([
			this.prisma.user.findMany(),
			this.prisma.group.findMany(),
			this.prisma.role.findMany(),
			this.prisma.userGroup.findMany(),
			this.prisma.userRole.findMany(),
		]);
		return {
			users,
			groups,
			roles,
			userGroups: userGroups.map((m) => ({ userId: m.userId, groupId: m.groupId })),
			userRoles: userRoles.map((m) => ({ userId: m.userId, roleId: m.roleId })),
		};
	}

	async importSnapshot(
		snapshot: IdentitySnapshot,
		mode: ImportMode,
		onProgress?: ImportProgress,
	): Promise<ImportCounts> {
		const counts: ImportCounts = {
			usersInserted: 0,
			usersUpdated: 0,
			groupsInserted: 0,
			groupsUpdated: 0,
			rolesInserted: 0,
			rolesUpdated: 0,
		};
		const total = snapshot.groups.length + snapshot.roles.length + snapshot.users.length;
		let done = 0;
		const tick = () => {
			done += 1;
			if (onProgress && (done % 100 === 0 || done === total)) {
				onProgress(done, total);
			}
		};

		const existingGroupIds = new Set(
			(await this.prisma.group.findMany({ select: { id: true } })).map((r) => r.id),
		);
		for (const g of snapshot.groups) {
			if (!existingGroupIds.has(g.id)) {
				await this.prisma.group.create({
					data: {
						id: g.id,
						externalId: g.externalId,
						apiConnectionId: g.apiConnectionId,
						origin: g.origin,
						name: g.name,
						createdAt: g.createdAt,
					},
				});
				counts.groupsInserted += 1;
			} else if (mode === 'upsert') {
				await this.prisma.group.update({ where: { id: g.id }, data: { name: g.name } });
				counts.groupsUpdated += 1;
			}
			tick();
		}

		const existingRoleIds = new Set(
			(await this.prisma.role.findMany({ select: { id: true } })).map((r) => r.id),
		);
		for (const r of snapshot.roles) {
			if (!existingRoleIds.has(r.id)) {
				await this.prisma.role.create({
					data: {
						id: r.id,
						externalId: r.externalId,
						apiConnectionId: r.apiConnectionId,
						origin: r.origin,
						name: r.name,
						createdAt: r.createdAt,
					},
				});
				counts.rolesInserted += 1;
			} else if (mode === 'upsert') {
				await this.prisma.role.update({ where: { id: r.id }, data: { name: r.name } });
				counts.rolesUpdated += 1;
			}
			tick();
		}

		const existingUserIds = new Set(
			(await this.prisma.user.findMany({ select: { id: true } })).map((r) => r.id),
		);
		for (const u of snapshot.users) {
			if (!existingUserIds.has(u.id)) {
				await this.prisma.user.create({
					data: {
						id: u.id,
						externalId: u.externalId,
						apiConnectionId: u.apiConnectionId,
						origin: u.origin,
						username: u.username,
						email: u.email,
						displayName: u.displayName,
						passwordHash: u.passwordHash,
						passwordHashAlgorithm: u.passwordHashAlgorithm,
						active: u.active,
						createdAt: u.createdAt,
					},
				});
				counts.usersInserted += 1;
			} else if (mode === 'upsert') {
				await this.prisma.user.update({
					where: { id: u.id },
					data: {
						username: u.username,
						email: u.email,
						displayName: u.displayName,
						passwordHash: u.passwordHash,
						passwordHashAlgorithm: u.passwordHashAlgorithm,
						active: u.active,
					},
				});
				counts.usersUpdated += 1;
			}
			tick();
		}

		const existingUg = new Set(
			(await this.prisma.userGroup.findMany()).map((m) => `${m.userId}|${m.groupId}`),
		);
		const newUg = snapshot.userGroups.filter((m) => !existingUg.has(`${m.userId}|${m.groupId}`));
		for (const part of chunk(newUg, 500)) {
			await this.prisma.userGroup.createMany({ data: part });
		}
		const existingUr = new Set(
			(await this.prisma.userRole.findMany()).map((m) => `${m.userId}|${m.roleId}`),
		);
		const newUr = snapshot.userRoles.filter((m) => !existingUr.has(`${m.userId}|${m.roleId}`));
		for (const part of chunk(newUr, 500)) {
			await this.prisma.userRole.createMany({ data: part });
		}
		return counts;
	}

	async wipeAll(): Promise<void> {
		await this.prisma.$transaction([
			this.prisma.userGroup.deleteMany(),
			this.prisma.userRole.deleteMany(),
			this.prisma.user.deleteMany(),
			this.prisma.group.deleteMany(),
			this.prisma.role.deleteMany(),
		]);
	}

	async syncedUserIdsForConnection(apiConnectionId: string): Promise<string[]> {
		const rows = await this.prisma.user.findMany({
			where: { apiConnectionId, origin: IdentityOrigin.SYNCED },
			select: { id: true },
		});
		return rows.map((r) => r.id);
	}

	async removeConnectionIdentities(
		apiConnectionId: string,
		mode: 'deactivate' | 'delete',
	): Promise<{ usersRemoved: number; groupsRemoved: number; rolesRemoved: number }> {
		const where = { apiConnectionId, origin: IdentityOrigin.SYNCED } as const;
		if (mode === 'deactivate') {
			const users = await this.prisma.user.findMany({ where, select: { id: true } });
			for (const part of chunk(users, 200)) {
				await this.prisma.$transaction([
					this.prisma.userGroup.deleteMany({ where: { userId: { in: part.map((u) => u.id) } } }),
					this.prisma.userRole.deleteMany({ where: { userId: { in: part.map((u) => u.id) } } }),
					this.prisma.user.updateMany({
						where: { id: { in: part.map((u) => u.id) } },
						data: { active: false },
					}),
				]);
			}
			return { usersRemoved: users.length, groupsRemoved: 0, rolesRemoved: 0 };
		}
		// Atomic so a crash can't leave a half-removed source (users gone, groups/roles lingering); the
		// membership rows cascade on user/group/role delete. Parity with the transactional deactivate branch.
		const [u, g, r] = await this.prisma.$transaction([
			this.prisma.user.deleteMany({ where }),
			this.prisma.group.deleteMany({ where }),
			this.prisma.role.deleteMany({ where }),
		]);
		return { usersRemoved: u.count, groupsRemoved: g.count, rolesRemoved: r.count };
	}

	async connectionHasIdentityRows(apiConnectionId: string): Promise<boolean> {
		const [u, g, r] = await Promise.all([
			this.prisma.user.count({ where: { apiConnectionId } }),
			this.prisma.group.count({ where: { apiConnectionId } }),
			this.prisma.role.count({ where: { apiConnectionId } }),
		]);
		return u + g + r > 0;
	}
}
