import {
	BadRequestException,
	Body,
	Controller,
	Get,
	HttpCode,
	HttpException,
	HttpStatus,
	Post,
	Query,
	Req,
	Res,
	UnauthorizedException,
	UseGuards,
	ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import type {
	EndUserLoginResponseDto,
	EndUserLogoutResponseDto,
	EndUserMeResponseDto,
	EndUserSessionStatusResponseDto,
} from '@nestidp/shared';
import { END_USER_SESSION_COOKIE_NAME } from '@nestidp/shared';
import { EndUserAuthGuard } from '../guards/end-user-auth.guard';
import type { EndUserAuthenticatedRequest } from '../end-user-auth.types';
import { SamlSsoService } from '../../saml/services/saml-sso.service';
import { EndUserAuthAuditService } from '../services/end-user-auth-audit.service';
import { EndUserAuthService } from '../services/end-user-auth.service';
import { EndUserSessionService } from '../services/end-user-session.service';
import { EndUserLoginRateLimiterService } from '../services/end-user-login-rate-limiter.service';
import { EndUserLoginBodyDto } from '../dto/end-user-login-body.dto';
import { CompleteSsoBodyDto } from '../dto/complete-sso-body.dto';

const CUID_PATTERN = /^c[a-z0-9]{24,}$/i;

@Controller('api/auth')
export class AuthController {
	constructor(
		private readonly endUserAuthService: EndUserAuthService,
		private readonly endUserSessionService: EndUserSessionService,
		private readonly rateLimiter: EndUserLoginRateLimiterService,
		private readonly samlSsoService: SamlSsoService,
		private readonly endUserAuthAudit: EndUserAuthAuditService,
	) {}

	@Post('login')
	@HttpCode(HttpStatus.OK)
	async login(
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: EndUserLoginBodyDto,
		@Req() req: EndUserAuthenticatedRequest,
		@Res({ passthrough: true }) res: Response,
	): Promise<EndUserLoginResponseDto> {
		const clientIp = req.ip ?? 'unknown';
		const username = body.username;

		if (
			this.rateLimiter.isLimitedByIp(clientIp) ||
			this.rateLimiter.isLimitedByUsername(username)
		) {
			throw new HttpException('Too many login attempts', HttpStatus.TOO_MANY_REQUESTS);
		}

		try {
			const result = await this.endUserAuthService.login(username, body.password, {
				samlSessionId: body.samlSessionId,
				clientIp,
			});
			const payload = this.endUserSessionService.createPayload(
				result.user.id,
				result.user.username,
			);
			this.endUserSessionService.setCookie(res, payload);
			this.rateLimiter.reset(clientIp, username);
			return result;
		} catch (error) {
			if (error instanceof UnauthorizedException) {
				this.rateLimiter.recordFailure(clientIp, username);
			} else if (!(error instanceof HttpException) || error.getStatus() < 500) {
				this.rateLimiter.recordFailure(clientIp, username);
			}
			throw error;
		}
	}

	@Post('logout')
	@HttpCode(HttpStatus.OK)
	logout(
		@Req() req: EndUserAuthenticatedRequest,
		@Res({ passthrough: true }) res: Response,
	): EndUserLogoutResponseDto {
		const token = req.cookies?.[END_USER_SESSION_COOKIE_NAME] as string | undefined;
		const payload = this.endUserSessionService.verify(token);
		if (payload) {
			// audit optional on logout — service layer could add; keep minimal in controller
		}
		this.endUserSessionService.clearCookie(res);
		return { ok: true };
	}

	@Get('me')
	@UseGuards(EndUserAuthGuard)
	me(@Req() req: EndUserAuthenticatedRequest): EndUserMeResponseDto {
		if (!req.endUser) {
			throw new UnauthorizedException('Unauthorized');
		}
		return { user: req.endUser };
	}

	@Get('session')
	@HttpCode(HttpStatus.OK)
	async session(
		@Query('samlSessionId') samlSessionId: string | undefined,
		@Req() req: EndUserAuthenticatedRequest,
	): Promise<EndUserSessionStatusResponseDto> {
		if (samlSessionId != null && samlSessionId.length > 0 && !CUID_PATTERN.test(samlSessionId)) {
			throw new BadRequestException('Invalid samlSessionId');
		}

		const token = req.cookies?.[END_USER_SESSION_COOKIE_NAME] as string | undefined;
		const payload = this.endUserSessionService.verify(token);

		return this.endUserAuthService.getSessionStatus({
			userId: payload?.userId,
			samlSessionId,
		});
	}

	@Post('login/complete-sso')
	@HttpCode(HttpStatus.OK)
	@UseGuards(EndUserAuthGuard)
	async completeSso(
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: CompleteSsoBodyDto,
		@Req() req: EndUserAuthenticatedRequest,
		@Res() res: Response,
	): Promise<void> {
		if (!req.endUser) {
			throw new UnauthorizedException('Unauthorized');
		}

		const clientIp = req.ip ?? 'unknown';
		try {
			const html = await this.samlSsoService.completeSso(body.samlSessionId, req.endUser.id);
			this.endUserAuthAudit.logSsoCompleteSuccess(body.samlSessionId, req.endUser.id, clientIp);
			res.setHeader('Content-Type', 'text/html; charset=utf-8');
			res.status(200).send(html);
		} catch (error) {
			const reason = error instanceof Error ? error.message : 'sso_complete_failed';
			this.endUserAuthAudit.logSsoCompleteFailure(body.samlSessionId, clientIp, reason);
			throw error;
		}
	}
}
