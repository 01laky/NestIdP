import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpException,
	HttpStatus,
	Param,
	Patch,
	Post,
	Req,
	UseGuards,
	ValidationPipe,
} from '@nestjs/common';
import {
	ADMIN_USERS_API_PATH,
	type AdminUserPublicDto,
	type DeleteAdminUserResponseDto,
} from '@nestidp/shared';
import { AdminAuthGuard } from '../../admin-auth/guards/admin-auth.guard';
import { AdminCsrfGuard } from '../../admin-auth/guards/admin-csrf.guard';
import { AdminAuthenticatedRequest } from '../../admin-auth/admin-auth.types';
import { ParseCuidPipe } from '../../common/pipes/parse-cuid.pipe';
import { AuditPersistenceService } from '../../audit/services/audit-persistence.service';
import { AdminUserCreateRateLimiterService } from '../services/admin-user-create-rate-limiter.service';
import { AdminUsersService } from '../services/admin-users.service';
import { CreateAdminUserBodyDto } from '../dto/create-admin-user.dto';
import { UpdateAdminUserBodyDto } from '../dto/update-admin-user.dto';

@Controller(ADMIN_USERS_API_PATH)
@UseGuards(AdminAuthGuard)
export class AdminUsersController {
	constructor(
		private readonly adminUsersService: AdminUsersService,
		private readonly createRateLimiter: AdminUserCreateRateLimiterService,
		private readonly audit: AuditPersistenceService,
	) {}

	@Get()
	list(): Promise<AdminUserPublicDto[]> {
		return this.adminUsersService.list();
	}

	@Post()
	@HttpCode(HttpStatus.CREATED)
	@UseGuards(AdminCsrfGuard)
	async create(
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: CreateAdminUserBodyDto,
		@Req() req: AdminAuthenticatedRequest,
	): Promise<AdminUserPublicDto> {
		const admin = req.adminUser;
		if (!admin) {
			throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
		}
		const clientIp = req.ip ?? 'unknown';
		if (this.createRateLimiter.isLimited(admin.id, clientIp)) {
			this.audit.recordSafe({
				category: 'admin_config',
				event: 'admin_user_create_rate_limited',
				actorType: 'admin',
				actorId: admin.id,
				actorLabel: admin.username,
				clientIp,
			});
			throw new HttpException(
				'Too many admin account creation attempts',
				HttpStatus.TOO_MANY_REQUESTS,
			);
		}
		this.createRateLimiter.recordAttempt(admin.id, clientIp);
		return this.adminUsersService.create(body, admin);
	}

	@Patch(':id')
	@UseGuards(AdminCsrfGuard)
	update(
		@Param('id', ParseCuidPipe) id: string,
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: UpdateAdminUserBodyDto,
		@Req() req: AdminAuthenticatedRequest,
	): Promise<AdminUserPublicDto> {
		const admin = req.adminUser;
		if (!admin) {
			throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
		}
		return this.adminUsersService.updatePassword(id, body, admin);
	}

	@Delete(':id')
	@UseGuards(AdminCsrfGuard)
	delete(
		@Param('id', ParseCuidPipe) id: string,
		@Req() req: AdminAuthenticatedRequest,
	): Promise<DeleteAdminUserResponseDto> {
		const admin = req.adminUser;
		if (!admin) {
			throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
		}
		return this.adminUsersService.delete(id, admin);
	}
}
