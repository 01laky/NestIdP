import { generateTestRsaEncryptionCert } from '@test/support/crypto/test-cert.util';
import { encryptAuthnRequestForIdp } from '@api/saml/utils/encrypt-authn-request-for-idp.util';
import {
	decryptXmlEncryptedElement,
	isEncryptedDataRoot,
	SamlXmlDecryptionError,
} from '@api/saml/utils/saml-xml-decryption.util';
import { buildAuthnRequestXml } from '@test/support/saml/build-authn-request.util';

describe('saml-xml-decryption.util', () => {
	const plainXml = buildAuthnRequestXml({
		id: '_decrypt-req',
		issuer: 'urn:test:decrypt',
		destination: 'http://localhost:3000/saml/sso',
	});

	it('API-SAML-REQ-DEC-UTIL-01: decrypts encrypted AuthnRequest round-trip', () => {
		const { certPem, privateKeyPem } = generateTestRsaEncryptionCert('urn:test:idp:decrypt');
		const encrypted = encryptAuthnRequestForIdp(plainXml, certPem);
		const decrypted = decryptXmlEncryptedElement(encrypted, privateKeyPem);
		expect(decrypted).toContain('AuthnRequest');
		expect(decrypted).toContain('urn:test:decrypt');
	});

	it('API-SAML-REQ-DEC-UTIL-02: wrong key fails unwrap with typed error', () => {
		const { certPem } = generateTestRsaEncryptionCert('urn:test:idp:decrypt-mismatch');
		const wrongKey = generateTestRsaEncryptionCert('urn:test:idp:wrong').privateKeyPem;
		const encrypted = encryptAuthnRequestForIdp(plainXml, certPem);
		expect(() => decryptXmlEncryptedElement(encrypted, wrongKey)).toThrow(SamlXmlDecryptionError);
		expect(() => decryptXmlEncryptedElement(encrypted, wrongKey)).toThrow(
			expect.objectContaining({ code: 'decrypt_key_unwrap_failed' }),
		);
	});

	it('API-SAML-REQ-DEC-UTIL-03: unsupported algorithm option throws unsupported code', () => {
		const { certPem, privateKeyPem } = generateTestRsaEncryptionCert('urn:test:idp:unsupported');
		const encrypted = encryptAuthnRequestForIdp(plainXml, certPem);
		expect(() =>
			decryptXmlEncryptedElement(encrypted, privateKeyPem, {
				contentEncryptionAlgorithmId: 'unsupported-content-id',
			}),
		).toThrow(expect.objectContaining({ code: 'encrypted_request_unsupported_algorithm' }));
	});

	it('API-SAML-REQ-DEC-UTIL-04: missing Algorithm URI throws missing_algorithm_uri', () => {
		const { certPem, privateKeyPem } = generateTestRsaEncryptionCert('urn:test:idp:missing-uri');
		const encrypted = encryptAuthnRequestForIdp(plainXml, certPem);
		const missingAlgorithm = encrypted.replace(/Algorithm="[^"]+"/, '');
		expect(() => decryptXmlEncryptedElement(missingAlgorithm, privateKeyPem)).toThrow(
			expect.objectContaining({ code: 'missing_algorithm_uri' }),
		);
	});

	it('API-SAML-REQ-DEC-UTIL-05: encrypted-root detector is strict to xenc namespace', () => {
		const encryptedRoot = '<xenc:EncryptedData xmlns:xenc="http://www.w3.org/2001/04/xmlenc#"/>';
		const plainRoot = '<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"/>';
		expect(isEncryptedDataRoot(encryptedRoot)).toBe(true);
		expect(isEncryptedDataRoot(plainRoot)).toBe(false);
	});
});
