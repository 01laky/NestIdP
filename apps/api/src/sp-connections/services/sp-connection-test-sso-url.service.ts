import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync } from 'node:crypto';
import type { SpConnectionTestSsoUrlResponseDto } from '@nestidp/shared';
import { SAML_SSO_PATH } from '@nestidp/shared';
import { PrismaService } from '../../prisma/services/prisma.service';
import {
	buildAuthnRequestXml,
	encodeRedirectBinding,
} from '../../saml/utils/build-authn-request.util';
import { encryptAuthnRequestForIdp } from '../../saml/utils/encrypt-authn-request-for-idp.util';
import { buildSignedAuthnRequestRedirectQuery } from '../../saml/utils/sign-authn-request-redirect.util';
import { getCachedIdpSettings } from '../../idp-settings/utils/idp-settings-cache.util';

@Injectable()
export class SpConnectionTestSsoUrlService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
	) {}

	async buildTestSsoUrl(
		id: string,
		options: { signed?: boolean; encrypted?: boolean; relayState?: string },
	): Promise<SpConnectionTestSsoUrlResponseDto> {
		const sp = await this.prisma.spConnection.findUnique({ where: { id } });
		if (!sp) {
			throw new NotFoundException('Service Provider connection not found');
		}

		const baseUrl = (this.configService.get<string>('IDP_BASE_URL') ?? '').replace(/\/+$/, '');
		const destination = `${baseUrl}${SAML_SSO_PATH}`;
		const authnRequestId = `_test-${Date.now()}`;
		let xml = buildAuthnRequestXml({
			id: authnRequestId,
			issuer: sp.spEntityId,
			destination,
		});

		let warning: string | undefined;
		const signed = options.signed === true;
		const encrypted = options.encrypted === true;

		if (encrypted) {
			const settings = await getCachedIdpSettings(this.prisma);
			if (!settings?.encryptionCertPem) {
				throw new BadRequestException('IdP encryption certificate required for encrypted test URL');
			}
			xml = encryptAuthnRequestForIdp(xml, settings.encryptionCertPem);
			if (settings.encryptionKeyFamily === 'ec') {
				warning = 'ec_key_agreement_sp_compat';
			}
		}

		const samlRequestRaw = encodeURIComponent(encodeRedirectBinding(xml));
		const queryParts = [`SAMLRequest=${samlRequestRaw}`];

		if (options.relayState) {
			queryParts.push(`RelayState=${encodeURIComponent(options.relayState)}`);
		}

		if (signed) {
			if (!sp.spCertificate?.trim()) {
				throw new BadRequestException('SP certificate required for signed test URL');
			}
			const envKey = this.configService.get<string>('SP_TEST_SIGNING_PRIVATE_KEY_PEM');
			let privateKeyPem = envKey?.trim();
			if (!privateKeyPem) {
				privateKeyPem = generateKeyPairSync('rsa', {
					modulusLength: 2048,
					privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
					publicKeyEncoding: { type: 'spki', format: 'pem' },
				}).privateKey;
				warning = 'signed_with_ephemeral_key_verify_sp_cert_matches';
			}

			const signedQuery = buildSignedAuthnRequestRedirectQuery({
				samlRequestRaw,
				spPrivateKeyPem: privateKeyPem,
				relayStateRaw: options.relayState ? encodeURIComponent(options.relayState) : undefined,
			});
			queryParts.push(`SigAlg=${signedQuery.sigAlg}`);
			queryParts.push(`Signature=${signedQuery.signature}`);
		}

		return {
			ssoUrl: `${destination}?${queryParts.join('&')}`,
			spEntityId: sp.spEntityId,
			authnRequestId,
			signed,
			encrypted,
			warning,
		};
	}
}
