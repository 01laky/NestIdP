import {
	Body,
	Controller,
	ForbiddenException,
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
import { ADMIN_CSRF_HEADER_NAME, ADMIN_SESSION_COOKIE_NAME } from '@nestidp/shared';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminCsrfGuard } from './admin-csrf.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthenticatedRequest, toAdminMeDto } from './admin-auth.types';
import type { AdminChangePasswordResponseDto } from '@nestidp/shared';
import { AdminChangePasswordBodyDto } from './admin-change-password.dto';
import { AdminLoginBodyDto } from './admin-login-body.dto';
import { AdminAuthAuditService } from './admin-auth-audit.service';
import { AdminSessionService } from './admin-session.service';
import { LoginRateLimiterService } from './login-rate-limiter.service';

@Controller('api/admin/auth')
export class AdminAuthController {
	constructor(
		private readonly adminAuthService: AdminAuthService,
		private readonly adminSessionService: AdminSessionService,
		private readonly loginRateLimiter: LoginRateLimiterService,
		private readonly adminAuthAudit: AdminAuthAuditService,
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
			const persistent = body.rememberMe === true;
			const admin = await this.adminAuthService.login(
				body.username,
				body.password,
				clientIp,
				persistent,
			);
			const ttl = this.adminSessionService.getSessionTtlSeconds(persistent);
			const payload = this.adminSessionService.createPayload(
				admin.id,
				admin.username,
				undefined,
				ttl,
			);
			this.adminSessionService.setCookie(res, payload, { persistent });
			this.loginRateLimiter.reset(clientIp);
			return { ok: true, admin, csrfToken: payload.csrfToken };
		} catch (error) {
			if (error instanceof UnauthorizedException) {
				this.loginRateLimiter.recordFailure(clientIp);
			}
			throw error;
		}
	}

	@Post('logout')
	@HttpCode(HttpStatus.OK)
	logout(
		@Req() req: AdminAuthenticatedRequest,
		@Res({ passthrough: true }) res: Response,
	): AdminLogoutResponseDto {
		const token = req.cookies?.[ADMIN_SESSION_COOKIE_NAME] as string | undefined;
		const payload = this.adminSessionService.verify(token);
		if (payload) {
			const header = req.headers?.[ADMIN_CSRF_HEADER_NAME.toLowerCase()];
			const headerValue = Array.isArray(header) ? header[0] : header;
			if (
				!headerValue ||
				headerValue !== payload.csrfToken ||
				typeof payload.csrfToken !== 'string'
			) {
				throw new ForbiddenException('Invalid CSRF token');
			}
		}
		if (payload && req.adminUser) {
			this.adminAuthAudit.logLogout(req.adminUser.id, req.adminUser.username, req.ip ?? 'unknown');
		}
		this.adminSessionService.clearCookie(res);
		return { ok: true };
	}

	@Post('change-password')
	@HttpCode(HttpStatus.OK)
	@UseGuards(AdminAuthGuard, AdminCsrfGuard)
	async changePassword(
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: AdminChangePasswordBodyDto,
		@Req() req: AdminAuthenticatedRequest,
	): Promise<AdminChangePasswordResponseDto> {
		if (!req.adminUser) {
			throw new UnauthorizedException('Unauthorized');
		}
		await this.adminAuthService.changePassword(
			req.adminUser.id,
			body.currentPassword,
			body.newPassword,
			req.ip ?? 'unknown',
		);
		return { ok: true };
	}

	@Get('me')
	@UseGuards(AdminAuthGuard)
	me(@Req() req: AdminAuthenticatedRequest): AdminMeResponseDto {
		if (!req.adminUser) {
			throw new UnauthorizedException('Unauthorized');
		}
		return {
			admin: toAdminMeDto(req.adminUser),
			csrfToken: req.adminSession?.csrfToken ?? '',
		};
	}
}
