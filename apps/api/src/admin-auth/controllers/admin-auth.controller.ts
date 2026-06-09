import {
	Body,
	Controller,
	ForbiddenException,
	Get,
	HttpCode,
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
import { AdminAuthGuard } from '../guards/admin-auth.guard';
import { AdminCsrfGuard } from '../guards/admin-csrf.guard';
import { AdminAuthService } from '../services/admin-auth.service';
import { AdminAuthenticatedRequest, toAdminMeDto } from '../admin-auth.types';
import type { AdminChangePasswordResponseDto } from '@nestidp/shared';
import { AdminChangePasswordBodyDto } from '../dto/admin-change-password.dto';
import { AdminLoginBodyDto } from '../dto/admin-login-body.dto';
import { AdminAuthAuditService } from '../services/admin-auth-audit.service';
import { AdminCsrfService } from '../services/admin-csrf.service';
import { AdminSessionService } from '../services/admin-session.service';
import { LoginProtectionService } from '../../auth-protection/login-protection.service';

@Controller('api/admin/auth')
export class AdminAuthController {
	constructor(
		private readonly adminAuthService: AdminAuthService,
		private readonly adminSessionService: AdminSessionService,
		private readonly loginProtection: LoginProtectionService,
		private readonly adminAuthAudit: AdminAuthAuditService,
		private readonly adminCsrf: AdminCsrfService,
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
		const usernameKey = body.username.trim();

		const pre = await this.loginProtection.precheckLogin('admin', usernameKey, clientIp);
		if (!pre.allowed) {
			this.loginProtection.enforceBlock(pre, res);
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
			await this.loginProtection.recordLoginSuccess('admin', usernameKey, clientIp);
			return { ok: true, admin, csrfToken: payload.csrfToken };
		} catch (error) {
			if (error instanceof UnauthorizedException) {
				await this.loginProtection.recordLoginFailure('admin', usernameKey, clientIp);
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
			// §5.A7: constant-time CSRF comparison (was a non-constant-time `!==`, a timing oracle).
			if (!this.adminCsrf.validateToken(headerValue, payload.csrfToken)) {
				throw new ForbiddenException('Invalid CSRF token');
			}
			// §5.A7: audit every authenticated logout. AdminAuthGuard is NOT applied to logout, so
			// `req.adminUser` was always undefined here and the old `&& req.adminUser` guard was dead —
			// logouts were never recorded. Derive the identity from the verified session payload instead.
			this.adminAuthAudit.logLogout(payload.adminUserId, payload.username, req.ip ?? 'unknown');
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
