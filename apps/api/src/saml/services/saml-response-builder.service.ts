import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { create } from 'xmlbuilder2';
import type { EndUserPublicDto, ParsedAuthnRequestDto } from '@nestidp/shared';
import type { SpConnection } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { escapeXmlAttr, escapeXmlText } from '../utils/saml-xml.util';
import { SamlAttributeMapperService } from './saml-attribute-mapper.service';
import { IdpSigningService } from './idp-signing.service';
import type { SpAttributeMappingConfig } from '@nestidp/shared';
import {
	encryptSignedAssertionForSp,
	SamlAssertionEncryptionError,
} from '../utils/saml-assertion-encryption.util';

export interface BuildLoginResponseInput {
	authnRequest: ParsedAuthnRequestDto;
	user: EndUserPublicDto;
	spConnection: SpConnection;
	idpEntityId: string;
}

export interface BuildLoginResponseResult {
	samlResponseXml: string;
	assertionXml: string;
	sessionIndex: string;
	nameId: string;
	nameIdFormat: string;
}

@Injectable()
export class SamlResponseBuilderService {
	constructor(
		private readonly configService: ConfigService,
		private readonly attributeMapper: SamlAttributeMapperService,
		private readonly idpSigning: IdpSigningService,
	) {}

	async buildLoginResponse(input: BuildLoginResponseInput): Promise<BuildLoginResponseResult> {
		const material = await this.idpSigning.ensureSigningMaterial();
		const mapping = (input.spConnection.attributeMapping ??
			null) as SpAttributeMappingConfig | null;
		const mapped = this.attributeMapper.mapUser(
			input.user,
			input.spConnection.nameIdFormat,
			mapping,
		);

		const now = new Date();
		const skewMs = this.getClockSkewSeconds() * 1000;
		const ttlMs = this.getAssertionTtlSeconds() * 1000;
		const notBefore = new Date(now.getTime() - skewMs);
		const notOnOrAfter = new Date(now.getTime() + ttlMs);

		const responseId = `_${randomBytes(16).toString('hex')}`;
		const assertionId = `_${randomBytes(16).toString('hex')}`;
		const sessionIndex = `_${randomBytes(8).toString('hex')}`;
		const issueInstant = now.toISOString();
		const notBeforeIso = notBefore.toISOString();
		const notOnOrAfterIso = notOnOrAfter.toISOString();

		const assertionDoc = create({ version: '1.0', encoding: 'UTF-8' })
			.ele('saml2:Assertion', {
				'xmlns:saml2': 'urn:oasis:names:tc:SAML:2.0:assertion',
				ID: assertionId,
				Version: '2.0',
				IssueInstant: issueInstant,
			})
			.ele('saml2:Issuer')
			.txt(input.idpEntityId)
			.up()
			.ele('saml2:Subject')
			.ele('saml2:NameID', { Format: mapped.nameIdFormat })
			.txt(mapped.nameId)
			.up()
			.ele('saml2:SubjectConfirmation', {
				Method: 'urn:oasis:names:tc:SAML:2.0:cm:bearer',
			})
			.ele('saml2:SubjectConfirmationData', {
				NotOnOrAfter: notOnOrAfterIso,
				Recipient: input.spConnection.acsUrl,
				InResponseTo: input.authnRequest.id,
			})
			.up()
			.up()
			.up()
			.ele('saml2:Conditions', { NotBefore: notBeforeIso, NotOnOrAfter: notOnOrAfterIso })
			.ele('saml2:AudienceRestriction')
			.ele('saml2:Audience')
			.txt(input.spConnection.spEntityId)
			.up()
			.up()
			.up()
			.ele('saml2:AuthnStatement', {
				AuthnInstant: issueInstant,
				SessionIndex: sessionIndex,
			})
			.ele('saml2:AuthnContext')
			.ele('saml2:AuthnContextClassRef')
			.txt('urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport')
			.up()
			.up()
			.up();

		if (mapped.attributes.length > 0) {
			const attrStatement = assertionDoc.ele('saml2:AttributeStatement');
			for (const attr of mapped.attributes) {
				const attrEl = attrStatement.ele('saml2:Attribute', { Name: attr.name });
				for (const value of attr.values) {
					attrEl.ele('saml2:AttributeValue').txt(value);
				}
			}
		}

		const assertionXml = assertionDoc.end({ prettyPrint: false, headless: true });
		const signedAssertionXml = this.idpSigning.signAssertion(assertionXml, material, assertionId);

		const assertionBody = this.buildAssertionBodyForResponse(
			signedAssertionXml,
			input.spConnection,
		);

		const responseXml = `<?xml version="1.0" encoding="UTF-8"?>
<saml2p:Response xmlns:saml2p="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml2="urn:oasis:names:tc:SAML:2.0:assertion" ID="${responseId}" Version="2.0" IssueInstant="${issueInstant}" Destination="${escapeXmlAttr(input.spConnection.acsUrl)}" InResponseTo="${escapeXmlAttr(input.authnRequest.id)}">
  <saml2:Issuer>${escapeXmlText(input.idpEntityId)}</saml2:Issuer>
  <saml2p:Status><saml2p:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></saml2p:Status>
  ${assertionBody}
</saml2p:Response>`;

		const outwardAssertionXml = input.spConnection.wantAssertionsEncrypted
			? assertionBody
			: signedAssertionXml;

		return {
			samlResponseXml: responseXml,
			assertionXml: outwardAssertionXml,
			sessionIndex,
			nameId: mapped.nameId,
			nameIdFormat: mapped.nameIdFormat,
		};
	}

	private buildAssertionBodyForResponse(
		signedAssertionXml: string,
		spConnection: SpConnection,
	): string {
		if (!spConnection.wantAssertionsEncrypted) {
			return signedAssertionXml.replace(/^<\?xml[^?]*\?>\s*/i, '').trim();
		}

		const spCertificate = spConnection.spCertificate?.trim();
		if (!spCertificate) {
			throw new BadRequestException(
				'SP certificate PEM is required when encrypted assertions are enabled',
			);
		}

		try {
			return encryptSignedAssertionForSp(signedAssertionXml, spCertificate);
		} catch (error) {
			if (error instanceof SamlAssertionEncryptionError) {
				throw new BadRequestException(error.message);
			}
			throw error;
		}
	}

	private getAssertionTtlSeconds(): number {
		const raw = this.configService.get<number | string>('SAML_ASSERTION_TTL_SECONDS');
		if (raw == null || raw === '') {
			return 300;
		}
		const parsed = Number.parseInt(String(raw), 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
	}

	private getClockSkewSeconds(): number {
		const raw = this.configService.get<number | string>('SAML_CLOCK_SKEW_SECONDS');
		if (raw == null || raw === '') {
			return 120;
		}
		const parsed = Number.parseInt(String(raw), 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
	}
}
