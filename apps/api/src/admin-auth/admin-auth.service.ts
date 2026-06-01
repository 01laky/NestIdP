import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { AdminMeDto } from '@nestidp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';

@Injectable()
export class AdminAuthService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly passwordService: PasswordService,
	) {}

	async login(username: string, password: string): Promise<AdminMeDto> {
		const admin = await this.prisma.adminUser.findUnique({ where: { username } });
		const valid = await this.passwordService.verifyTimingSafe(
			password,
			admin?.passwordHash ?? null,
		);

		if (!valid || !admin) {
			throw new UnauthorizedException('Invalid credentials');
		}

		return { id: admin.id, username: admin.username };
	}

	async resolveAuthenticatedAdmin(adminUserId: string): Promise<AdminMeDto> {
		const admin = await this.prisma.adminUser.findUnique({ where: { id: adminUserId } });
		if (!admin) {
			throw new UnauthorizedException('Unauthorized');
		}
		return { id: admin.id, username: admin.username };
	}
}
