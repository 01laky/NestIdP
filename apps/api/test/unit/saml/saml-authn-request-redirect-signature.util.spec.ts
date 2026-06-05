import {
	buildRedirectBindingSignedContent,
	extractRawQueryStringFromRequestUrl,
	parseRawSamlRedirectQuery,
	verifyRedirectBindingSignature,
} from '@api/saml/utils/saml-authn-request-redirect-signature.util';
import { buildSignedAuthnRequestRedirectQuery } from '@api/saml/utils/sign-authn-request-redirect.util';
import { getTestSigningMaterial } from '@test/support/prisma/test-fixtures';

describe('saml-authn-request-redirect-signature.util', () => {
	const samlRequestRaw = encodeURIComponent('dGVzdC1yZXF1ZXN0');
	const relayStateRaw = encodeURIComponent('relay-state-01');
	const { certPem, privateKeyPem } = getTestSigningMaterial('urn:test:sp:req-sig');

	it('API-SAML-REQ-SIG-UTIL-01: extracts query string from URL', () => {
		expect(extractRawQueryStringFromRequestUrl('/saml/sso?SAMLRequest=abc&RelayState=1')).toBe(
			'SAMLRequest=abc&RelayState=1',
		);
	});

	it('API-SAML-REQ-SIG-UTIL-02: missing query string returns empty string', () => {
		expect(extractRawQueryStringFromRequestUrl('/saml/sso')).toBe('');
	});

	it('API-SAML-REQ-SIG-UTIL-03: parses only SAML redirect signature params', () => {
		const parsed = parseRawSamlRedirectQuery(
			`foo=bar&SAMLRequest=${samlRequestRaw}&RelayState=${relayStateRaw}&SigAlg=alg&Signature=sig`,
		);
		expect(parsed).toEqual({
			samlRequest: samlRequestRaw,
			relayState: relayStateRaw,
			sigAlg: 'alg',
			signature: 'sig',
		});
	});

	it('API-SAML-REQ-SIG-UTIL-04: builds signed content without RelayState', () => {
		const content = buildRedirectBindingSignedContent({
			samlRequestRaw,
			sigAlgRaw: encodeURIComponent('http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'),
		});
		expect(content).toBe(
			'SAMLRequest=dGVzdC1yZXF1ZXN0&SigAlg=http%3A%2F%2Fwww.w3.org%2F2001%2F04%2Fxmldsig-more%23rsa-sha256',
		);
	});

	it('API-SAML-REQ-SIG-UTIL-05: builds signed content with RelayState in canonical order', () => {
		const content = buildRedirectBindingSignedContent({
			samlRequestRaw,
			relayStateRaw,
			sigAlgRaw: encodeURIComponent('http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'),
		});
		expect(content).toContain(`SAMLRequest=${samlRequestRaw}`);
		expect(content).toContain(`RelayState=${relayStateRaw}`);
		expect(content).toContain('SigAlg=');
		expect(content.indexOf('SAMLRequest=')).toBeLessThan(content.indexOf('RelayState='));
		expect(content.indexOf('RelayState=')).toBeLessThan(content.indexOf('SigAlg='));
	});

	it('API-SAML-REQ-SIG-UTIL-06: verifies valid RSA redirect signature', () => {
		const signed = buildSignedAuthnRequestRedirectQuery({
			samlRequestRaw,
			relayStateRaw,
			spPrivateKeyPem: privateKeyPem,
		});
		const signedContent = buildRedirectBindingSignedContent({
			samlRequestRaw,
			relayStateRaw,
			sigAlgRaw: signed.sigAlg,
		});
		const valid = verifyRedirectBindingSignature({
			signedContent,
			signatureBase64UrlEncoded: signed.signature,
			sigAlgUri: decodeURIComponent(signed.sigAlg),
			certificatePem: certPem,
		});
		expect(valid).toBe(true);
	});

	it('API-SAML-REQ-SIG-UTIL-07: rejects tampered signed content', () => {
		const signed = buildSignedAuthnRequestRedirectQuery({
			samlRequestRaw,
			spPrivateKeyPem: privateKeyPem,
		});
		const valid = verifyRedirectBindingSignature({
			signedContent: `SAMLRequest=${encodeURIComponent('tampered')}&SigAlg=${signed.sigAlg}`,
			signatureBase64UrlEncoded: signed.signature,
			sigAlgUri: decodeURIComponent(signed.sigAlg),
			certificatePem: certPem,
		});
		expect(valid).toBe(false);
	});

	it('API-SAML-REQ-SIG-UTIL-08: rejects unsupported SigAlg URI', () => {
		const valid = verifyRedirectBindingSignature({
			signedContent: `SAMLRequest=${samlRequestRaw}&SigAlg=unsupported`,
			signatureBase64UrlEncoded: encodeURIComponent(Buffer.from('sig').toString('base64')),
			sigAlgUri: 'urn:unsupported:algorithm',
			certificatePem: certPem,
		});
		expect(valid).toBe(false);
	});

	it('API-SAML-REQ-SIG-UTIL-09: rejects invalid certificate PEM', () => {
		const signed = buildSignedAuthnRequestRedirectQuery({
			samlRequestRaw,
			spPrivateKeyPem: privateKeyPem,
		});
		const signedContent = buildRedirectBindingSignedContent({
			samlRequestRaw,
			sigAlgRaw: signed.sigAlg,
		});
		const valid = verifyRedirectBindingSignature({
			signedContent,
			signatureBase64UrlEncoded: signed.signature,
			sigAlgUri: decodeURIComponent(signed.sigAlg),
			certificatePem: 'not-a-certificate',
		});
		expect(valid).toBe(false);
	});

	it('API-SAML-REQ-SIG-UTIL-10: ignores malformed query segments without equals sign', () => {
		const parsed = parseRawSamlRedirectQuery(
			'SAMLRequest=abc&broken-segment&SigAlg=alg&Signature=sig',
		);
		expect(parsed.samlRequest).toBe('abc');
		expect(parsed.sigAlg).toBe('alg');
		expect(parsed.signature).toBe('sig');
	});

	it('API-SAML-REQ-SIG-UTIL-11: signature fails when RelayState presence differs from signed payload', () => {
		const signed = buildSignedAuthnRequestRedirectQuery({
			samlRequestRaw,
			relayStateRaw,
			spPrivateKeyPem: privateKeyPem,
		});
		const signedContentWithoutRelay = buildRedirectBindingSignedContent({
			samlRequestRaw,
			sigAlgRaw: signed.sigAlg,
		});
		const valid = verifyRedirectBindingSignature({
			signedContent: signedContentWithoutRelay,
			signatureBase64UrlEncoded: signed.signature,
			sigAlgUri: decodeURIComponent(signed.sigAlg),
			certificatePem: certPem,
		});
		expect(valid).toBe(false);
	});
});
