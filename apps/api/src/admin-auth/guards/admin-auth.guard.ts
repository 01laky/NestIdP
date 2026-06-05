import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { ADMIN_SESSION_COOKIE_NAME } from '@nestidp/shared';
import { AdminAuthService } from '../services/admin-auth.service';
import { AdminAuthenticatedRequest } from '../admin-auth.types';
import { AdminSessionService } from '../services/admin-session.service';

@Injectable()
export class AdminAuthGuard implements CanActivate {
	constructor(
		private readonly adminSessionService: AdminSessionService,
		private readonly adminAuthService: AdminAuthService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<AdminAuthenticatedRequest>();
		const response = context.switchToHttp().getResponse<Response>();
		const token = request.cookies?.[ADMIN_SESSION_COOKIE_NAME] as string | undefined;
		const payload = this.adminSessionService.verify(token);

		if (!payload) {
			throw new UnauthorizedException('Unauthorized');
		}

		try {
			const admin = await this.adminAuthService.resolveAuthenticatedAdmin(payload.adminUserId);
			request.adminUser = admin;
			request.adminSession = payload;
			return true;
		} catch {
			this.adminSessionService.clearCookie(response);
			throw new UnauthorizedException('Unauthorized');
		}
	}
}
