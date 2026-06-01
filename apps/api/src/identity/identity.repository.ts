import { Injectable } from '@nestjs/common';
import { Group, Prisma, Role, User } from '@prisma/client';
import { normalizeSyncedEmail } from './normalize-synced-email.util';
import { PrismaService } from '../prisma/prisma.service';

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

export type UpsertUserInput = {
	externalId: string;
	username: string;
	email: string | null;
	displayName: string | null;
	passwordHash: string;
	passwordHashAlgorithm: string;
	active: boolean;
};

@Injectable()
export class IdentityRepository {
	constructor(private readonly prisma: PrismaService) {}

	countUsers(): Promise<number> {
		return this.prisma.user.count();
	}

	countGroups(): Promise<number> {
		return this.prisma.group.count();
	}

	countRoles(): Promise<number> {
		return this.prisma.role.count();
	}

	async upsertUser(connectionId: string, user: UpsertUserInput): Promise<User> {
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

		return this.prisma.user.upsert({
			where: {
				apiConnectionId_externalId: {
					apiConnectionId: connectionId,
					externalId: user.externalId,
				},
			},
			create: {
				apiConnectionId: connectionId,
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
	}

	async replaceUserGroups(userId: string, groupIds: string[]): Promise<void> {
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
		await this.prisma.$transaction(async (tx) => {
			await tx.userRole.deleteMany({ where: { userId } });
			if (roleIds.length > 0) {
				await tx.userRole.createMany({
					data: roleIds.map((roleId) => ({ userId, roleId })),
				});
			}
		});
	}

	async upsertGroup(
		connectionId: string,
		externalGroup: { id: string; name: string },
	): Promise<Group> {
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
	): Promise<Role> {
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
				externalId: { notIn: Array.from(seenExternalIds) },
			},
		});
		return result.count;
	}

	async deleteOrphanRoles(connectionId: string, seenExternalIds: Set<string>): Promise<number> {
		const result = await this.prisma.role.deleteMany({
			where: {
				apiConnectionId: connectionId,
				externalId: { notIn: Array.from(seenExternalIds) },
			},
		});
		return result.count;
	}
}
