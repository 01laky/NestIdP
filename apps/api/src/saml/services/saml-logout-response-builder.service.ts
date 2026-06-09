import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { escapeXmlAttr, escapeXmlText } from '../utils/saml-xml.util';
import {
	SAML_STATUS_REQUEST_DENIED,
	SAML_STATUS_RESPONDER,
	SAML_STATUS_SUCCESS,
} from '@nestidp/shared';

export type LogoutResponseStatus = 'success' | 'request_denied';

export interface BuildLogoutResponseInput {
	inResponseTo: string;
	destination: string;
	idpEntityId: string;
	status: LogoutResponseStatus;
}

export interface BuiltLogoutResponse {
	xml: string;
	responseId: string;
}

@Injectable()
export class SamlLogoutResponseBuilderService {
	build(input: BuildLogoutResponseInput): BuiltLogoutResponse {
		const responseId = `_${randomBytes(16).toString('hex')}`;
		const issueInstant = new Date().toISOString();
		const statusXml =
			input.status === 'success'
				? `<samlp:StatusCode Value="${SAML_STATUS_SUCCESS}"/>`
				: `<samlp:StatusCode Value="${SAML_STATUS_RESPONDER}"><samlp:StatusCode Value="${SAML_STATUS_REQUEST_DENIED}"/></samlp:StatusCode>`;

		const xml = `<samlp:LogoutResponse xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml2="urn:oasis:names:tc:SAML:2.0:assertion" ID="${responseId}" Version="2.0" IssueInstant="${issueInstant}" Destination="${escapeXmlAttr(input.destination)}" InResponseTo="${escapeXmlAttr(input.inResponseTo)}"><saml2:Issuer>${escapeXmlText(input.idpEntityId)}</saml2:Issuer><samlp:Status>${statusXml}</samlp:Status></samlp:LogoutResponse>`;

		return { xml, responseId };
	}
}
