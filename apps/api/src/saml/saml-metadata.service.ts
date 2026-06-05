import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SAML_SSO_PATH } from '@nestidp/shared';
import { create } from 'xmlbuilder2';
import { PrismaService } from '../prisma/prisma.service';
import { IdpEncryptionService } from './idp-encryption.service';
import { IdpSigningService } from './idp-signing.service';

@Injectable()
export class SamlMetadataService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
		private readonly idpSigning: IdpSigningService,
		private readonly idpEncryption: IdpEncryptionService,
	) {}

	async generateMetadata(): Promise<string> {
		const settings = await this.prisma.idpSettings.findUnique({ where: { id: 'default' } });
		if (!settings) {
			throw new Error('IdP settings not configured');
		}

		const certPems = await this.idpSigning.getMetadataSigningCertificates();
		const encryptionCertPems = await this.idpEncryption.getMetadataEncryptionCertificates();
		const baseUrl = (this.configService.get<string>('IDP_BASE_URL') ?? '').replace(/\/+$/, '');
		const ssoUrl = `${baseUrl}${SAML_SSO_PATH}`;

		const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele('md:EntityDescriptor', {
			'xmlns:md': 'urn:oasis:names:tc:SAML:2.0:metadata',
			entityID: settings.entityId,
		});

		const idp = doc.ele('md:IDPSSODescriptor', {
			protocolSupportEnumeration: 'urn:oasis:names:tc:SAML:2.0:protocol',
			wantAuthnRequestsSigned: 'false',
		});

		for (const certPem of certPems) {
			const certBody = this.idpSigning.extractX509CertificatePem(certPem);
			idp
				.ele('md:KeyDescriptor', { use: 'signing' })
				.ele('ds:KeyInfo', { 'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#' })
				.ele('ds:X509Data')
				.ele('ds:X509Certificate')
				.txt(certBody);
		}

		for (const certPem of encryptionCertPems) {
			const certBody = this.idpEncryption.extractX509CertificatePem(certPem);
			idp
				.ele('md:KeyDescriptor', { use: 'encryption' })
				.ele('ds:KeyInfo', { 'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#' })
				.ele('ds:X509Data')
				.ele('ds:X509Certificate')
				.txt(certBody);
		}

		idp.ele('md:NameIDFormat').txt(settings.nameIdFormat);
		idp.ele('md:NameIDFormat').txt('urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified');

		idp.ele('md:SingleSignOnService', {
			Binding: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
			Location: ssoUrl,
		});

		if (this.shouldIncludeAttributeConsumingService()) {
			const acs = idp.ele('md:AttributeConsumingService', {
				index: '1',
				isDefault: 'true',
			});
			acs.ele('md:ServiceName', { 'xml:lang': 'en' }).txt('NestIdP');
			for (const name of ['email', 'displayName', 'memberOf', 'role']) {
				acs.ele('md:RequestedAttribute', {
					Name: name,
					isRequired: 'false',
				});
			}
		}

		return doc.end({ prettyPrint: false });
	}

	private shouldIncludeAttributeConsumingService(): boolean {
		const raw = this.configService.get<string | boolean>('SAML_METADATA_INCLUDE_ACS');
		if (raw === undefined || raw === null || raw === '') {
			return true;
		}
		if (typeof raw === 'boolean') {
			return raw;
		}
		return raw.toLowerCase() !== 'false' && raw !== '0';
	}
}
