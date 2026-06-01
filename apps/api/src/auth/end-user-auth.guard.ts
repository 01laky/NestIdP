import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { END_USER_SESSION_COOKIE_NAME } from '@nestidp/shared';
import type { EndUserAuthenticatedRequest } from './end-user-auth.types';
import { EndUserAuthService } from './end-user-auth.service';
import { EndUserSessionService } from './end-user-session.service';

@Injectable()
export class EndUserAuthGuard implements CanActivate {
	constructor(
		private readonly endUserSessionService: EndUserSessionService,
		private readonly endUserAuthService: EndUserAuthService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<EndUserAuthenticatedRequest>();
		const token = request.cookies?.[END_USER_SESSION_COOKIE_NAME] as string | undefined;
		const response = context.switchToHttp().getResponse<Response>();
		const payload = this.endUserSessionService.verify(token);
		if (!payload) {
			throw new UnauthorizedException('Unauthorized');
		}

		try {
			const user = await this.endUserAuthService.getMe(payload.userId);
			request.endUser = user;
			request.endUserSession = payload;
			return true;
		} catch {
			this.endUserSessionService.clearCookie(response);
			throw new UnauthorizedException('Unauthorized');
		}
	}
}
