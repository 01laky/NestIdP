import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import type { SamlLogoutBindingType } from '@nestidp/shared';

export class SamlLogoutParseError extends Error {
	readonly reason: string;
	constructor(reason: string, message?: string) {
		super(message ?? reason);
		this.name = 'SamlLogoutParseError';
		this.reason = reason;
	}
}

export interface ParsedLogoutRequest {
	id: string;
	issuer: string;
	destination?: string;
	issueInstant: string;
	notOnOrAfter?: string;
	nameId: string;
	nameIdFormat?: string;
	sessionIndexes: string[];
	bindingType: SamlLogoutBindingType;
	rawXml: string;
	hasSignature: boolean;
}

const select = xpath.useNamespaces({
	samlp: 'urn:oasis:names:tc:SAML:2.0:protocol',
	saml: 'urn:oasis:names:tc:SAML:2.0:assertion',
	ds: 'http://www.w3.org/2000/09/xmldsig#',
});

export function parseLogoutRequestXml(
	xml: string,
	bindingType: SamlLogoutBindingType,
	options: { clockSkewSeconds: number },
): ParsedLogoutRequest {
	let doc: ReturnType<DOMParser['parseFromString']>;
	try {
		doc = new DOMParser().parseFromString(xml, 'text/xml');
	} catch {
		throw new SamlLogoutParseError('logout_request_malformed', 'Invalid LogoutRequest XML');
	}
	const parseError = (doc as { parseError?: { errorCode: number } }).parseError;
	if (parseError && parseError.errorCode !== 0) {
		throw new SamlLogoutParseError('logout_request_malformed', 'Invalid LogoutRequest XML');
	}

	const nodes = select('//samlp:LogoutRequest', doc as unknown as Node) as Node[];
	if (!nodes.length) {
		throw new SamlLogoutParseError('logout_request_malformed', 'Not a LogoutRequest');
	}
	const root = nodes[0] as Element;

	const id = root.getAttribute('ID');
	if (!id || id.length > 256) {
		throw new SamlLogoutParseError('logout_request_malformed', 'Invalid LogoutRequest ID');
	}

	const issuerNodes = select('saml:Issuer', root) as Node[];
	const issuer = issuerNodes.length > 0 ? (issuerNodes[0].textContent ?? '').trim() : '';
	if (!issuer) {
		throw new SamlLogoutParseError('logout_request_malformed', 'Missing Issuer');
	}

	// Encrypted NameID is not supported in this release.
	const encryptedIdNodes = select('saml:EncryptedID', root) as Node[];
	if (encryptedIdNodes.length > 0) {
		throw new SamlLogoutParseError('logout_request_malformed', 'EncryptedID is not supported');
	}

	const nameIdNodes = select('saml:NameID', root) as Node[];
	if (!nameIdNodes.length) {
		throw new SamlLogoutParseError('logout_request_malformed', 'Missing NameID');
	}
	const nameIdEl = nameIdNodes[0] as Element;
	const nameId = (nameIdEl.textContent ?? '').trim();
	if (!nameId) {
		throw new SamlLogoutParseError('logout_request_malformed', 'Empty NameID');
	}
	const nameIdFormat = nameIdEl.getAttribute('Format') ?? undefined;

	const issueInstant = root.getAttribute('IssueInstant');
	if (!issueInstant || Number.isNaN(Date.parse(issueInstant))) {
		throw new SamlLogoutParseError('logout_issue_instant_invalid', 'Invalid IssueInstant');
	}
	validateIssueInstant(issueInstant, options.clockSkewSeconds);

	const notOnOrAfter = root.getAttribute('NotOnOrAfter') ?? undefined;
	if (notOnOrAfter) {
		const parsed = Date.parse(notOnOrAfter);
		if (Number.isNaN(parsed)) {
			throw new SamlLogoutParseError('logout_request_malformed', 'Invalid NotOnOrAfter');
		}
		if (parsed <= Date.now() - options.clockSkewSeconds * 1000) {
			throw new SamlLogoutParseError('logout_request_expired', 'LogoutRequest has expired');
		}
	}

	const destination = root.getAttribute('Destination') ?? undefined;

	const sessionIndexNodes = select('samlp:SessionIndex', root) as Node[];
	const sessionIndexes = sessionIndexNodes
		.map((node) => (node.textContent ?? '').trim())
		.filter((value) => value.length > 0);

	const sigNodes = select('ds:Signature', root) as Node[];
	const hasSignature = sigNodes.length > 0;

	return {
		id,
		issuer,
		destination,
		issueInstant,
		notOnOrAfter,
		nameId,
		nameIdFormat,
		sessionIndexes,
		bindingType,
		rawXml: xml,
		hasSignature,
	};
}

function validateIssueInstant(issueInstant: string, skewSeconds: number): void {
	const instantMs = Date.parse(issueInstant);
	const now = Date.now();
	const skewMs = skewSeconds * 1000;
	if (instantMs > now + skewMs) {
		throw new SamlLogoutParseError('logout_issue_instant_invalid', 'IssueInstant is in the future');
	}
	if (instantMs < now - skewMs) {
		throw new SamlLogoutParseError('logout_issue_instant_invalid', 'IssueInstant is too old');
	}
}
