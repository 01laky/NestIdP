import {
	hasEnvelopedSignature,
	verifyEnvelopedXmlDsig,
} from '@api/saml/utils/saml-enveloped-signature.util';
import {
	buildSignedLogoutPostBody,
	generateTestSpSigningKeyPair,
} from '@test/support/saml/build-logout-request.util';

describe('saml-enveloped-signature.util', () => {
	let sp: { privateKeyPem: string; certPem: string };
	let other: { privateKeyPem: string; certPem: string };

	beforeAll(() => {
		sp = generateTestSpSigningKeyPair('sp');
		other = generateTestSpSigningKeyPair('other');
	});

	it('API-SLO-SIG-03: valid enveloped signature on LogoutRequest verifies', () => {
		const { xml } = buildSignedLogoutPostBody({
			issuer: 'urn:test:sp',
			spPrivateKeyPem: sp.privateKeyPem,
			spCertificatePem: sp.certPem,
		});
		expect(hasEnvelopedSignature(xml)).toBe(true);
		expect(verifyEnvelopedXmlDsig(xml, sp.certPem)).toBe(true);
	});

	it('API-SLO-SIG-04: signature verified against the wrong cert fails', () => {
		const { xml } = buildSignedLogoutPostBody({
			issuer: 'urn:test:sp',
			spPrivateKeyPem: sp.privateKeyPem,
			spCertificatePem: sp.certPem,
		});
		expect(verifyEnvelopedXmlDsig(xml, other.certPem)).toBe(false);
	});

	it('returns false when there is no signature', () => {
		expect(hasEnvelopedSignature('<samlp:LogoutRequest/>')).toBe(false);
		expect(verifyEnvelopedXmlDsig('<samlp:LogoutRequest/>', sp.certPem)).toBe(false);
	});

	it('EDGE: tampering the signed payload after signing breaks verification', () => {
		const { xml } = buildSignedLogoutPostBody({
			issuer: 'urn:test:sp',
			nameId: 'alice@example.com',
			spPrivateKeyPem: sp.privateKeyPem,
			spCertificatePem: sp.certPem,
		});
		const tampered = xml.replace('alice@example.com', 'attacker@example.com');
		expect(tampered).not.toBe(xml);
		expect(verifyEnvelopedXmlDsig(tampered, sp.certPem)).toBe(false);
	});

	it('EDGE: malformed XML returns false (never throws)', () => {
		expect(verifyEnvelopedXmlDsig('<broken', sp.certPem)).toBe(false);
		expect(hasEnvelopedSignature('<broken')).toBe(false);
	});

	it('EDGE: garbage certificate returns false', () => {
		const { xml } = buildSignedLogoutPostBody({
			issuer: 'urn:test:sp',
			spPrivateKeyPem: sp.privateKeyPem,
			spCertificatePem: sp.certPem,
		});
		expect(verifyEnvelopedXmlDsig(xml, 'not-a-cert')).toBe(false);
	});
});
