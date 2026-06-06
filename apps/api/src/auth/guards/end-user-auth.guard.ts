import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { END_USER_SESSION_COOKIE_NAME } from '@nestidp/shared';
import type { EndUserAuthenticatedRequest } from '../end-user-auth.types';
import { EndUserAuthService } from '../services/end-user-auth.service';
import { EndUserSessionService } from '../services/end-user-session.service';
import { SamlSsoSessionService } from '../../saml-sessions/services/saml-sso-session.service';

@Injectable()
export class EndUserAuthGuard implements CanActivate {
	constructor(
		private readonly endUserSessionService: EndUserSessionService,
		private readonly endUserAuthService: EndUserAuthService,
		private readonly ssoSessions: SamlSsoSessionService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<EndUserAuthenticatedRequest>();
		const token = request.cookies?.[END_USER_SESSION_COOKIE_NAME] as string | undefined;
		const response = context.switchToHttp().getResponse<Response>();
		const payload = this.endUserSessionService.verify(token);
		if (!payload) {
			throw new UnauthorizedException('Unauthorized');
		}

		// Revocation: a terminated/expired/missing server-side SSO session invalidates
		// the otherwise-stateless cookie. Cookies issued before v1.8.0 have no `sid`
		// and are treated as inactive (force one re-login after deploy).
		const active = await this.ssoSessions.isActive(payload.sid);
		if (!active) {
			this.endUserSessionService.clearCookie(response);
			throw new UnauthorizedException('Unauthorized');
		}

		try {
			const user = await this.endUserAuthService.getMe(payload.userId);
			request.endUser = user;
			request.endUserSession = payload;
			void this.ssoSessions.touch(payload.sid, request.ip);
			return true;
		} catch {
			this.endUserSessionService.clearCookie(response);
			throw new UnauthorizedException('Unauthorized');
		}
	}
}
