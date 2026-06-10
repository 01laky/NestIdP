import { deflateRawSync, inflateRawSync, inflateSync } from 'node:zlib';

export function buildAuthnRequestXml(options: {
	id: string;
	issuer: string;
	destination: string;
	issueInstant?: string;
}): string {
	const issueInstant = options.issueInstant ?? new Date().toISOString();
	return `<?xml version="1.0" encoding="UTF-8"?>
<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${options.id}" Version="2.0" IssueInstant="${issueInstant}" Destination="${options.destination}" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect">
  <saml:Issuer>${escapeXml(options.issuer)}</saml:Issuer>
</samlp:AuthnRequest>`;
}

export function encodeRedirectBinding(xml: string): string {
	const deflated = deflateRawSync(Buffer.from(xml, 'utf8'));
	return deflated.toString('base64');
}

export function decodeRedirectBinding(encoded: string): string {
	const decoded = Buffer.from(encoded, 'base64');
	try {
		return inflateRawSync(decoded).toString('utf8');
	} catch {
		return inflateSync(decoded).toString('utf8');
	}
}

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}
