import { Injectable } from '@nestjs/common';

export interface BuildLogoutRequestInput {
	/** Stable per-delivery request ID, reused on retry (idempotent + InResponseTo match). */
	requestId: string;
	destination: string;
	idpEntityId: string;
	nameId: string;
	nameIdFormat: string;
	sessionIndexes: string[];
	/** Validity window in seconds for NotOnOrAfter. */
	validitySeconds: number;
}

export interface BuiltLogoutRequest {
	xml: string;
	requestId: string;
}

/**
 * Builds a bare `<samlp:LogoutRequest>` for the back-channel SOAP SLO (Prompt 36). Mirrors the response
 * builder; the caller signs it via IdpSigningService.signLogoutRequest. The `requestId` is supplied (not
 * generated) so retries reuse it.
 */
@Injectable()
export class SamlLogoutRequestBuilderService {
	build(input: BuildLogoutRequestInput): BuiltLogoutRequest {
		const issueInstant = new Date();
		const notOnOrAfter = new Date(issueInstant.getTime() + input.validitySeconds * 1000);
		const sessionIndexXml = input.sessionIndexes
			.map((idx) => `<samlp:SessionIndex>${escapeXmlText(idx)}</samlp:SessionIndex>`)
			.join('');

		const xml =
			`<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ` +
			`xmlns:saml2="urn:oasis:names:tc:SAML:2.0:assertion" ID="${escapeXmlAttr(input.requestId)}" ` +
			`Version="2.0" IssueInstant="${issueInstant.toISOString()}" ` +
			`NotOnOrAfter="${notOnOrAfter.toISOString()}" Destination="${escapeXmlAttr(input.destination)}">` +
			`<saml2:Issuer>${escapeXmlText(input.idpEntityId)}</saml2:Issuer>` +
			`<saml2:NameID Format="${escapeXmlAttr(input.nameIdFormat)}">${escapeXmlText(input.nameId)}</saml2:NameID>` +
			`${sessionIndexXml}</samlp:LogoutRequest>`;

		return { xml, requestId: input.requestId };
	}
}

function escapeXmlText(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeXmlAttr(value: string): string {
	return escapeXmlText(value).replaceAll('"', '&quot;');
}
