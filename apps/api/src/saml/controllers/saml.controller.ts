import {
	Controller,
	Get,
	HttpCode,
	MethodNotAllowedException,
	Post,
	Query,
	Req,
	Res,
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
	@HttpCode(405)
	postSso(): never {
		throw new MethodNotAllowedException('Use HTTP-Redirect binding for SAMLRequest');
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
