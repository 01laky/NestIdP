import { Injectable } from '@nestjs/common';
import type { AdminStatsDto } from '@nestidp/shared';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminStatsService {
	constructor(
		private readonly identityService: IdentityService,
		private readonly prisma: PrismaService,
	) {}

	async getCounts(): Promise<AdminStatsDto> {
		const [users, groups, roles, apiConnections, spConnections] = await Promise.all([
			this.identityService.countUsers(),
			this.identityService.countGroups(),
			this.identityService.countRoles(),
			this.prisma.apiConnection.count({ where: { isLocalDirectory: false } }),
			this.prisma.spConnection.count(),
		]);

		return {
			users,
			groups,
			roles,
			apiConnections,
			spConnections,
		};
	}
}
