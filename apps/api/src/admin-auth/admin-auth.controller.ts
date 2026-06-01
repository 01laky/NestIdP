import {
	Body,
	Controller,
	Get,
	HttpCode,
	HttpException,
	HttpStatus,
	Post,
	Req,
	Res,
	UnauthorizedException,
	UseGuards,
	ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import type {
	AdminLoginResponseDto,
	AdminLogoutResponseDto,
	AdminMeResponseDto,
} from '@nestidp/shared';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthenticatedRequest, toAdminMeDto } from './admin-auth.types';
import { AdminLoginBodyDto } from './admin-login-body.dto';
import { AdminSessionService } from './admin-session.service';
import { LoginRateLimiterService } from './login-rate-limiter.service';

@Controller('api/admin/auth')
export class AdminAuthController {
	constructor(
		private readonly adminAuthService: AdminAuthService,
		private readonly adminSessionService: AdminSessionService,
		private readonly loginRateLimiter: LoginRateLimiterService,
	) {}

	@Post('login')
	@HttpCode(HttpStatus.OK)
	async login(
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: AdminLoginBodyDto,
		@Req() req: AdminAuthenticatedRequest,
		@Res({ passthrough: true }) res: Response,
	): Promise<AdminLoginResponseDto> {
		const clientIp = req.ip ?? 'unknown';

		if (this.loginRateLimiter.isLimited(clientIp)) {
			throw new HttpException('Too many login attempts', HttpStatus.TOO_MANY_REQUESTS);
		}

		try {
			const admin = await this.adminAuthService.login(body.username, body.password);
			const payload = this.adminSessionService.createPayload(admin.id, admin.username);
			this.adminSessionService.setCookie(res, payload);
			this.loginRateLimiter.reset(clientIp);
			return { ok: true, admin };
		} catch (error) {
			if (error instanceof UnauthorizedException) {
				this.loginRateLimiter.recordFailure(clientIp);
			}
			throw error;
		}
	}

	@Post('logout')
	@HttpCode(HttpStatus.OK)
	logout(@Res({ passthrough: true }) res: Response): AdminLogoutResponseDto {
		this.adminSessionService.clearCookie(res);
		return { ok: true };
	}

	@Get('me')
	@UseGuards(AdminAuthGuard)
	me(@Req() req: AdminAuthenticatedRequest): AdminMeResponseDto {
		if (!req.adminUser) {
			throw new UnauthorizedException('Unauthorized');
		}
		return { admin: toAdminMeDto(req.adminUser) };
	}
}
