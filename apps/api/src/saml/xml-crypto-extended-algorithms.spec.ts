import { generateKeyPairSync } from 'node:crypto';
import { SignedXml } from 'xml-crypto';
import { IDP_SIGNING_SIGNATURE_ALGORITHMS } from '@nestidp/shared';
import { IdpSigningService } from './idp-signing.service';
import { applyNestIdpXmlCryptoExtensions } from './xml-crypto-extended-algorithms';
import { verifySamlXmlSignature } from './testing/verify-saml-signature.util';

function buildAssertionXml(id: string): string {
	return `<saml2:Assertion xmlns:saml2="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="2026-01-01T00:00:00.000Z"><saml2:Issuer>http://idp.example.com</saml2:Issuer></saml2:Assertion>`;
}

describe('xml-crypto extended algorithms', () => {
	const signingService = new IdpSigningService({} as never, {} as never, {} as never, {} as never);

	it('API-SAML-EXT-01: rsa-sha384 sign and verify round-trip', () => {
		const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
		const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
		const certPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
		const assertionId = '_rsa384';
		const signed = signingService.signAssertion(
			buildAssertionXml(assertionId),
			{ certPem, privateKeyPem, signatureAlgorithmId: 'rsa-sha384' },
			assertionId,
		);
		expect(signed).toContain('rsa-sha384');
		expect(verifySamlXmlSignature(`<container>${signed}</container>`, certPem)).toBe(true);
	});

	it('API-SAML-EXT-02: ecdsa-sha384 sign and verify round-trip', () => {
		const generated = signingService.generateKeyPairAndCert('https://ec384.example.com', {
			keyFamily: 'ec',
			ecCurve: 'P-384',
			signatureAlgorithmId: 'ecdsa-sha384',
			notAfter: '2030-01-01',
		});
		const assertionId = '_ec384';
		const signed = signingService.signAssertion(
			buildAssertionXml(assertionId),
			{
				certPem: generated.certPem,
				privateKeyPem: generated.privateKeyPem,
				signatureAlgorithmId: 'ecdsa-sha384',
			},
			assertionId,
		);
		expect(verifySamlXmlSignature(`<container>${signed}</container>`, generated.certPem)).toBe(
			true,
		);
	});

	it('API-SAML-EXT-03: sha384 digest algorithm registered on SignedXml', () => {
		const sig = new SignedXml();
		applyNestIdpXmlCryptoExtensions(sig);
		expect(sig.HashAlgorithms['http://www.w3.org/2001/04/xmlenc#sha384']).toBeDefined();
		expect(
			sig.SignatureAlgorithms['http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512'],
		).toBeDefined();
	});

	it('API-SAML-EXT-04: every extended SignatureAlgorithm URI is registered', () => {
		const sig = new SignedXml();
		applyNestIdpXmlCryptoExtensions(sig);
		const extended = IDP_SIGNING_SIGNATURE_ALGORITHMS.filter(
			(a) =>
				a.xmlSignatureAlgorithm.includes('rsa-sha384') || a.xmlSignatureAlgorithm.includes('ecdsa'),
		);
		for (const algo of extended) {
			expect(sig.SignatureAlgorithms[algo.xmlSignatureAlgorithm]).toBeDefined();
		}
	});

	it('API-SAML-EXT-05: ecdsa-sha512 P-521 round-trip', () => {
		const generated = signingService.generateKeyPairAndCert('https://ec521.example.com', {
			keyFamily: 'ec',
			ecCurve: 'P-521',
			signatureAlgorithmId: 'ecdsa-sha512',
			notAfter: '2030-06-01',
		});
		const assertionId = '_ec521';
		const signed = signingService.signAssertion(
			buildAssertionXml(assertionId),
			{
				certPem: generated.certPem,
				privateKeyPem: generated.privateKeyPem,
				signatureAlgorithmId: 'ecdsa-sha512',
			},
			assertionId,
		);
		expect(verifySamlXmlSignature(`<container>${signed}</container>`, generated.certPem)).toBe(
			true,
		);
	});
});
