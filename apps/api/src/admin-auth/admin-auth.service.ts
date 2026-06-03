import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AdminMeDto } from '@nestidp/shared';
import { assertStrongAdminPassword } from '@nestidp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuthAuditService } from './admin-auth-audit.service';
import { PasswordService } from './password.service';

@Injectable()
export class AdminAuthService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly passwordService: PasswordService,
		private readonly configService: ConfigService,
		private readonly audit: AdminAuthAuditService,
	) {}

	async login(username: string, password: string, clientIp: string): Promise<AdminMeDto> {
		const normalizedUsername = username.trim();
		const admin = await this.prisma.adminUser.findUnique({
			where: { username: normalizedUsername },
		});
		const valid = await this.passwordService.verifyTimingSafe(
			password,
			admin?.passwordHash ?? null,
		);

		if (!valid || !admin) {
			this.audit.logLoginFailure(normalizedUsername, clientIp);
			throw new UnauthorizedException('Invalid credentials');
		}

		this.audit.logLoginSuccess(admin.id, admin.username, clientIp);
		return { id: admin.id, username: admin.username };
	}

	async changePassword(
		adminUserId: string,
		currentPassword: string,
		newPassword: string,
		clientIp: string,
	): Promise<void> {
		if (currentPassword === newPassword) {
			throw new BadRequestException('New password must differ from current password');
		}
		try {
			assertStrongAdminPassword(
				this.configService.get<string>('NODE_ENV') ?? 'development',
				newPassword,
			);
		} catch {
			throw new BadRequestException('Password does not meet production strength requirements');
		}

		const admin = await this.prisma.adminUser.findUnique({ where: { id: adminUserId } });
		if (!admin) {
			throw new UnauthorizedException('Unauthorized');
		}

		const valid = await this.passwordService.verifyTimingSafe(currentPassword, admin.passwordHash);
		if (!valid) {
			throw new UnauthorizedException('Invalid credentials');
		}

		const passwordHash = await this.passwordService.hash(newPassword);
		await this.prisma.adminUser.update({
			where: { id: adminUserId },
			data: { passwordHash },
		});
		this.audit.logPasswordChanged(admin.id, admin.username, clientIp);
	}

	async resolveAuthenticatedAdmin(adminUserId: string): Promise<AdminMeDto> {
		const admin = await this.prisma.adminUser.findUnique({ where: { id: adminUserId } });
		if (!admin) {
			throw new UnauthorizedException('Unauthorized');
		}
		return { id: admin.id, username: admin.username };
	}
}
