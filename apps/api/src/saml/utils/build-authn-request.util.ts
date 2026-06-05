import { deflateRawSync, inflateRawSync, inflateSync } from 'node:zlib';
import { createPrivateKey } from 'node:crypto';
import { SignedXml } from 'xml-crypto';
import { applyNestIdpXmlCryptoExtensions } from '../xml-crypto-extended-algorithms';

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

export function buildTestAuthnRequestRedirectPayload(options: {
	id?: string;
	issuer: string;
	destination?: string;
	relayState?: string;
}): { samlRequest: string; relayState?: string } {
	const id = options.id ?? `_test-${Date.now()}`;
	const destination = options.destination ?? 'http://localhost:3000/saml/sso';
	const xml = buildAuthnRequestXml({ id, issuer: options.issuer, destination });
	return {
		samlRequest: encodeURIComponent(encodeRedirectBinding(xml)),
		relayState: options.relayState,
	};
}

/** Build a POST binding body with plain (unsigned) base64-encoded AuthnRequest. */
export function buildPlainAuthnRequestPostBody(options: {
	issuer?: string;
	id?: string;
	destination?: string;
	issueInstant?: string;
	relayState?: string;
}): { samlRequestBase64: string; relayState?: string } {
	const id = options.id ?? `_post-${Date.now()}`;
	const issuer = options.issuer ?? 'urn:test:sp';
	const destination = options.destination ?? 'http://localhost:3000/saml/sso';
	const xml = buildAuthnRequestXml({ id, issuer, destination, issueInstant: options.issueInstant });
	return {
		samlRequestBase64: Buffer.from(xml.replace(/^<\?xml[^?]*\?>\s*/i, '').trim(), 'utf8').toString('base64'),
		relayState: options.relayState,
	};
}

/** Build a POST binding body with enveloped XML-DSig inside AuthnRequest. */
export function buildSignedAuthnRequestPostBody(options: {
	issuer?: string;
	id?: string;
	destination?: string;
	issueInstant?: string;
	spPrivateKeyPem: string;
	spCertificatePem: string;
	relayState?: string;
}): { samlRequestBase64: string; relayState?: string } {
	const id = options.id ?? `_post-signed-${Date.now()}`;
	const issuer = options.issuer ?? 'urn:test:sp';
	const destination = options.destination ?? 'http://localhost:3000/saml/sso';
	const xml = buildAuthnRequestXml({ id, issuer, destination, issueInstant: options.issueInstant });
	const plainXml = xml.replace(/^<\?xml[^?]*\?>\s*/i, '').trim();

	const privKey = createPrivateKey({ key: options.spPrivateKeyPem, format: 'pem' });
	const sig = new SignedXml({
		privateKey: privKey,
		publicCert: options.spCertificatePem,
		signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
		canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
	});
	applyNestIdpXmlCryptoExtensions(sig);
	sig.addReference({
		xpath: `//*[@ID='${id}']`,
		transforms: [
			'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
			'http://www.w3.org/2001/10/xml-exc-c14n#',
		],
		digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
	});
	sig.computeSignature(plainXml);
	const signedXml = sig.getSignedXml();

	return {
		samlRequestBase64: Buffer.from(signedXml, 'utf8').toString('base64'),
		relayState: options.relayState,
	};
}

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}
