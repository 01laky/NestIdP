import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
	IdentityGroupListResponseDto,
	IdentityRoleListResponseDto,
	IdentityUserDetailResponseDto,
	IdentityUserListResponseDto,
} from '@nestidp/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class IdentityAdminService {
	constructor(private readonly prisma: PrismaService) {}

	async listUsers(
		limitRaw?: number,
		offsetRaw?: number,
		search?: string,
	): Promise<IdentityUserListResponseDto> {
		const limit = this.parseLimit(limitRaw);
		const offset = this.parseOffset(offsetRaw);
		const where = this.buildUserSearchWhere(search);

		const [rows, total] = await Promise.all([
			this.prisma.user.findMany({
				where,
				orderBy: { username: 'asc' },
				skip: offset,
				take: limit,
				select: {
					id: true,
					username: true,
					email: true,
					displayName: true,
					active: true,
					externalId: true,
					apiConnectionId: true,
				},
			}),
			this.prisma.user.count({ where }),
		]);

		return {
			items: rows.map((row) => ({
				id: row.id,
				username: row.username,
				email: row.email,
				displayName: row.displayName,
				active: row.active,
				externalId: row.externalId,
				apiConnectionId: row.apiConnectionId,
			})),
			total,
		};
	}

	async getUserById(id: string): Promise<IdentityUserDetailResponseDto> {
		const row = await this.prisma.user.findUnique({
			where: { id },
			select: {
				id: true,
				username: true,
				email: true,
				displayName: true,
				active: true,
				externalId: true,
				apiConnectionId: true,
				groups: {
					select: { group: { select: { id: true, name: true } } },
				},
				roles: {
					select: { role: { select: { id: true, name: true } } },
				},
			},
		});

		if (!row) {
			throw new NotFoundException('User not found');
		}

		return {
			user: {
				id: row.id,
				username: row.username,
				email: row.email,
				displayName: row.displayName,
				active: row.active,
				externalId: row.externalId,
				apiConnectionId: row.apiConnectionId,
			},
			groups: row.groups.map((g) => g.group).sort((a, b) => a.name.localeCompare(b.name)),
			roles: row.roles.map((r) => r.role).sort((a, b) => a.name.localeCompare(b.name)),
		};
	}

	async listGroups(limitRaw?: number, offsetRaw?: number): Promise<IdentityGroupListResponseDto> {
		const limit = this.parseLimit(limitRaw);
		const offset = this.parseOffset(offsetRaw);

		const [rows, total] = await Promise.all([
			this.prisma.group.findMany({
				orderBy: { name: 'asc' },
				skip: offset,
				take: limit,
				select: { id: true, name: true, externalId: true, apiConnectionId: true },
			}),
			this.prisma.group.count(),
		]);

		return { items: rows, total };
	}

	async listRoles(limitRaw?: number, offsetRaw?: number): Promise<IdentityRoleListResponseDto> {
		const limit = this.parseLimit(limitRaw);
		const offset = this.parseOffset(offsetRaw);

		const [rows, total] = await Promise.all([
			this.prisma.role.findMany({
				orderBy: { name: 'asc' },
				skip: offset,
				take: limit,
				select: { id: true, name: true, externalId: true, apiConnectionId: true },
			}),
			this.prisma.role.count(),
		]);

		return { items: rows, total };
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

	private buildUserSearchWhere(search?: string): Prisma.UserWhereInput {
		if (!search || search.trim().length === 0) {
			return {};
		}
		const term = search.trim();
		return {
			OR: [{ username: { contains: term } }, { email: { contains: term } }],
		};
	}
}
