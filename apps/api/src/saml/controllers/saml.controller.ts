import {
	BadRequestException,
	Body,
	Controller,
	Get,
	HttpException,
	HttpStatus,
	Post,
	Query,
	Req,
	Res,
	UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import {
	END_USER_SESSION_COOKIE_NAME,
	LOGGED_OUT_ROUTE,
	RELAY_STATE_QUERY_PARAM,
	SAML_REQUEST_QUERY_PARAM,
} from '@nestidp/shared';
import { NodeEnv } from '../../config/env.validation';
import { SamlSsoService } from '../services/saml-sso.service';
import { SamlLogoutService, type SamlLogoutResult } from '../services/saml-logout.service';
import { SamlSloRateLimiterService } from '../services/saml-slo-rate-limiter.service';
import {
	extractRawQueryStringFromRequestUrl,
	parseRawSamlRedirectQuery,
} from '../utils/saml-authn-request-redirect-signature.util';

@Controller('saml')
export class SamlController {
	constructor(
		private readonly samlSsoService: SamlSsoService,
		private readonly samlLogoutService: SamlLogoutService,
		private readonly sloRateLimiter: SamlSloRateLimiterService,
		private readonly configService: ConfigService,
	) {}

	@Get('metadata')
	async getMetadata(@Res() res: Response): Promise<void> {
		const xml = await this.samlSsoService.getMetadataXml();
		res.setHeader('Content-Type', 'application/saml-metadata+xml; charset=utf-8');
		res.status(200).send(xml);
	}

	@Get('sso')
	async getSso(
		@Query(SAML_REQUEST_QUERY_PARAM) samlRequest: string | undefined,
		@Query(RELAY_STATE_QUERY_PARAM) relayState: string | undefined,
		@Req() req: Request,
		@Res() res: Response,
	): Promise<void> {
		const clientIp = req.ip ?? 'unknown';
		const rawQuery = extractRawQueryStringFromRequestUrl(req.url ?? '');
		const raw = parseRawSamlRedirectQuery(rawQuery);
		const { redirectUrl } = await this.samlSsoService.handleRedirectSso({
			decoded: { samlRequest: samlRequest ?? '', relayState },
			raw,
			clientIp,
		});
		res.redirect(302, redirectUrl);
	}

	@Post('sso')
	async postSso(
		@Body(SAML_REQUEST_QUERY_PARAM) samlRequest: string | undefined,
		@Body(RELAY_STATE_QUERY_PARAM) relayState: string | undefined,
		@Req() req: Request,
		@Res() res: Response,
	): Promise<void> {
		const contentType = req.headers['content-type'] ?? '';
		if (!contentType.startsWith('application/x-www-form-urlencoded')) {
			throw new UnsupportedMediaTypeException(
				'POST /saml/sso requires Content-Type: application/x-www-form-urlencoded',
			);
		}
		if (!samlRequest) {
			throw new BadRequestException('Missing SAMLRequest');
		}
		const clientIp = req.ip ?? 'unknown';
		const { redirectUrl } = await this.samlSsoService.handlePostSso({
			samlRequest,
			relayState,
			clientIp,
		});
		res.redirect(302, redirectUrl);
	}

	@Get('slo')
	async getSlo(
		@Query(SAML_REQUEST_QUERY_PARAM) samlRequest: string | undefined,
		@Query(RELAY_STATE_QUERY_PARAM) relayState: string | undefined,
		@Req() req: Request,
		@Res() res: Response,
	): Promise<void> {
		const clientIp = req.ip ?? 'unknown';
		this.enforceRateLimit(clientIp);
		const rawQuery = extractRawQueryStringFromRequestUrl(req.url ?? '');
		const raw = parseRawSamlRedirectQuery(rawQuery);
		const result = await this.samlLogoutService.handleRedirectSlo({
			samlRequest: samlRequest ?? '',
			relayState,
			raw,
			clientIp,
		});
		this.deliver(res, result);
	}

	@Post('slo')
	async postSlo(
		@Body(SAML_REQUEST_QUERY_PARAM) samlRequest: string | undefined,
		@Body(RELAY_STATE_QUERY_PARAM) relayState: string | undefined,
		@Req() req: Request,
		@Res() res: Response,
	): Promise<void> {
		const contentType = req.headers['content-type'] ?? '';
		if (!contentType.startsWith('application/x-www-form-urlencoded')) {
			throw new UnsupportedMediaTypeException(
				'POST /saml/slo requires Content-Type: application/x-www-form-urlencoded',
			);
		}
		const clientIp = req.ip ?? 'unknown';
		this.enforceRateLimit(clientIp);
		const result = await this.samlLogoutService.handlePostSlo({
			samlRequest: samlRequest ?? '',
			relayState,
			clientIp,
		});
		this.deliver(res, result);
	}

	private enforceRateLimit(clientIp: string): void {
		if (this.sloRateLimiter.hitAndCheck(clientIp)) {
			throw new HttpException('Too many logout requests', HttpStatus.TOO_MANY_REQUESTS);
		}
	}

	private deliver(res: Response, result: SamlLogoutResult): void {
		if (result.clearEndUserCookie) {
			this.clearEndUserCookie(res);
		}
		switch (result.delivery.type) {
			case 'redirect':
				res.redirect(302, result.delivery.url);
				return;
			case 'post':
				res.setHeader('Content-Type', 'text/html; charset=utf-8');
				res.status(200).send(result.delivery.html);
				return;
			case 'logged-out':
				res.redirect(302, LOGGED_OUT_ROUTE);
				return;
		}
	}

	private clearEndUserCookie(res: Response): void {
		const secure = this.configService.get<string>('NODE_ENV') === NodeEnv.Production;
		res.clearCookie(END_USER_SESSION_COOKIE_NAME, {
			httpOnly: true,
			secure,
			sameSite: 'lax',
			path: '/',
		});
	}
}
