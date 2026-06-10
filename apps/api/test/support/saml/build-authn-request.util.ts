import { createPrivateKey } from 'node:crypto';
import { SignedXml } from 'xml-crypto';
import { applyNestIdpXmlCryptoExtensions } from '@api/saml/xml-crypto-extended-algorithms';
import {
	buildAuthnRequestXml,
	encodeRedirectBinding,
} from '@api/saml/utils/build-authn-request.util';

/**
 * Test-only AuthnRequest builders (Prompt 38 §A13 / §6.10). These were previously shipped in
 * `apps/api/src/saml/utils/build-authn-request.util.ts`, which pulled `xml-crypto`/`createPrivateKey` into
 * the production graph purely for tests. The production redirect/POST encoders and `buildAuthnRequestXml`
 * stay in `src`; this support module re-exports them and adds the fixtures used by the SAML test suites.
 */
export {
	buildAuthnRequestXml,
	decodeRedirectBinding,
	encodeRedirectBinding,
} from '@api/saml/utils/build-authn-request.util';

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
		samlRequestBase64: Buffer.from(xml.replace(/^<\?xml[^?]*\?>\s*/i, '').trim(), 'utf8').toString(
			'base64',
		),
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
