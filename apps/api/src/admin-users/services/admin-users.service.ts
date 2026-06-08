import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
	AdminUserPublicDto,
	CreateAdminUserRequestDto,
	DeleteAdminUserResponseDto,
	UpdateAdminUserRequestDto,
} from '@nestidp/shared';
import type { UnlockAccountResponseDto } from '@nestidp/shared';
import { assertStrongAdminPassword } from '@nestidp/shared';
import { PrismaService } from '../../prisma/services/prisma.service';
import { PasswordService } from '../../admin-auth/services/password.service';
import { AuditPersistenceService } from '../../audit/services/audit-persistence.service';
import {
	AccountLockoutService,
	toAccountLockoutStatusDto,
} from '../../auth-protection/account-lockout.service';
import { AuthProtectionAuditService } from '../../auth-protection/auth-protection-audit.service';
import { toAdminUserPublicDto } from '../mappers/admin-users.mapper';

@Injectable()
export class AdminUsersService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly passwordService: PasswordService,
		private readonly configService: ConfigService,
		private readonly audit: AuditPersistenceService,
		private readonly accountLockout: AccountLockoutService,
		private readonly protectionAudit: AuthProtectionAuditService,
	) {}

	async list(): Promise<AdminUserPublicDto[]> {
		const rows = await this.prisma.adminUser.findMany({ orderBy: { username: 'asc' } });
		const statuses = await this.accountLockout.getStatusMany(
			'admin',
			rows.map((r) => r.username.trim()),
		);
		return rows.map((row) => ({
			...toAdminUserPublicDto(row),
			lockout: toAccountLockoutStatusDto(
				statuses.get(row.username.trim()) ?? {
					locked: false,
					lockedUntil: null,
					failedCount: 0,
					lastFailedAt: null,
				},
			),
		}));
	}

	/** Operator unlock of a brute-force-locked admin account. */
	async unlock(
		id: string,
		actor: { id: string; username: string },
		clientIp: string,
	): Promise<UnlockAccountResponseDto> {
		const existing = await this.prisma.adminUser.findUnique({ where: { id } });
		if (!existing) {
			throw new NotFoundException('Admin user not found');
		}
		await this.accountLockout.unlock('admin', existing.username.trim());
		this.protectionAudit.logAccountUnlocked(
			'admin',
			existing.username.trim(),
			actor.id,
			actor.username,
			clientIp,
		);
		return { ok: true, id };
	}

	async create(
		body: CreateAdminUserRequestDto,
		actor: { id: string; username: string },
	): Promise<AdminUserPublicDto> {
		this.validatePassword(body.password);
		const username = body.username.trim();
		if (!username) {
			throw new BadRequestException('username is required');
		}

		try {
			const passwordHash = await this.passwordService.hash(body.password);
			const row = await this.prisma.adminUser.create({
				data: { username, passwordHash },
			});
			this.audit.recordSafe({
				category: 'admin_config',
				event: 'admin_user_created',
				actorType: 'admin',
				actorId: actor.id,
				actorLabel: actor.username,
				subjectType: 'AdminUser',
				subjectId: row.id,
				metadata: { username: row.username },
			});
			return toAdminUserPublicDto(row);
		} catch (error) {
			if (
				error &&
				typeof error === 'object' &&
				'code' in error &&
				(error as { code: string }).code === 'P2002'
			) {
				throw new ConflictException('Admin username already exists');
			}
			throw error;
		}
	}

	async updatePassword(
		id: string,
		body: UpdateAdminUserRequestDto,
		actor: { id: string; username: string },
	): Promise<AdminUserPublicDto> {
		this.validatePassword(body.password);
		const existing = await this.prisma.adminUser.findUnique({ where: { id } });
		if (!existing) {
			throw new NotFoundException('Admin user not found');
		}

		const passwordHash = await this.passwordService.hash(body.password);
		const row = await this.prisma.adminUser.update({
			where: { id },
			data: { passwordHash },
		});
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'admin_user_updated',
			actorType: 'admin',
			actorId: actor.id,
			actorLabel: actor.username,
			subjectType: 'AdminUser',
			subjectId: row.id,
			metadata: { username: row.username },
		});
		return toAdminUserPublicDto(row);
	}

	async delete(
		id: string,
		actor: { id: string; username: string },
	): Promise<DeleteAdminUserResponseDto> {
		const existing = await this.prisma.adminUser.findUnique({ where: { id } });
		if (!existing) {
			throw new NotFoundException('Admin user not found');
		}
		if (actor.id === id) {
			throw new ConflictException('Cannot delete your own admin account while logged in');
		}
		const count = await this.prisma.adminUser.count();
		if (count <= 1) {
			throw new ConflictException('Cannot delete the last admin account');
		}

		await this.prisma.adminUser.delete({ where: { id } });
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'admin_user_deleted',
			actorType: 'admin',
			actorId: actor.id,
			actorLabel: actor.username,
			subjectType: 'AdminUser',
			subjectId: id,
			metadata: { username: existing.username },
		});
		return { ok: true, id };
	}

	private validatePassword(password: string): void {
		try {
			assertStrongAdminPassword(
				this.configService.get<string>('NODE_ENV') ?? 'development',
				password,
			);
		} catch {
			throw new BadRequestException('Password does not meet production strength requirements');
		}
	}
}
