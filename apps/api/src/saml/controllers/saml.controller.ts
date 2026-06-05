import {
	BadRequestException,
	Body,
	Controller,
	Get,
	HttpCode,
	Post,
	Query,
	Req,
	Res,
	UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SAML_REQUEST_QUERY_PARAM, RELAY_STATE_QUERY_PARAM } from '@nestidp/shared';
import { SamlSsoService } from '../services/saml-sso.service';
import {
	extractRawQueryStringFromRequestUrl,
	parseRawSamlRedirectQuery,
} from '../utils/saml-authn-request-redirect-signature.util';

@Controller('saml')
export class SamlController {
	constructor(private readonly samlSsoService: SamlSsoService) {}

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
	@HttpCode(501)
	getSlo() {
		return {
			status: 'not_implemented',
			endpoint: '/saml/slo',
			message: 'Single Logout will be implemented in a later release.',
		};
	}

	@Post('slo')
	@HttpCode(501)
	postSlo() {
		return this.getSlo();
	}
}
