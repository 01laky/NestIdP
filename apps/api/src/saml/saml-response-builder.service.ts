import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { create } from 'xmlbuilder2';
import type { EndUserPublicDto, ParsedAuthnRequestDto } from '@nestidp/shared';
import type { SpConnection } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { SamlAttributeMapperService } from './saml-attribute-mapper.service';
import { IdpSigningService } from './idp-signing.service';
import type { SpAttributeMappingConfig } from '@nestidp/shared';

export interface BuildLoginResponseInput {
	authnRequest: ParsedAuthnRequestDto;
	user: EndUserPublicDto;
	spConnection: SpConnection;
	idpEntityId: string;
}

export interface BuildLoginResponseResult {
	samlResponseXml: string;
	assertionXml: string;
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

		const assertionBody = signedAssertionXml.replace(/^<\?xml[^?]*\?>\s*/i, '').trim();

		const responseXml = `<?xml version="1.0" encoding="UTF-8"?>
<saml2p:Response xmlns:saml2p="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml2="urn:oasis:names:tc:SAML:2.0:assertion" ID="${responseId}" Version="2.0" IssueInstant="${issueInstant}" Destination="${escapeXmlAttr(input.spConnection.acsUrl)}" InResponseTo="${escapeXmlAttr(input.authnRequest.id)}">
  <saml2:Issuer>${escapeXmlText(input.idpEntityId)}</saml2:Issuer>
  <saml2p:Status><saml2p:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></saml2p:Status>
  ${assertionBody}
</saml2p:Response>`;

		return {
			samlResponseXml: responseXml,
			assertionXml: signedAssertionXml,
		};
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

function escapeXmlText(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeXmlAttr(value: string): string {
	return escapeXmlText(value).replaceAll('"', '&quot;');
}
