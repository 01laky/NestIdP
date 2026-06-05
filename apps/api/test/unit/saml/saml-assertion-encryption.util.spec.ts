import { getTestSpEncryptionKeyPair } from '@test/support/prisma/test-fixtures';
import { decryptEncryptedAssertion } from '@test/support/saml/decrypt-saml-assertion.util';
import { verifySamlXmlSignature } from '@test/support/saml/verify-saml-signature.util';
import {
	encryptSignedAssertionForSp,
	SamlAssertionEncryptionError,
} from '@api/saml/utils/saml-assertion-encryption.util';

describe('saml-assertion-encryption.util', () => {
	const signedAssertion = `<saml2:Assertion xmlns:saml2="urn:oasis:names:tc:SAML:2.0:assertion" ID="_assertion-test" Version="2.0" IssueInstant="2026-01-01T00:00:00.000Z">
  <saml2:Issuer>http://localhost:3000</saml2:Issuer>
  <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignedInfo/></ds:Signature>
</saml2:Assertion>`;

	it('API-SAML-ENC-UTIL-01: produces EncryptedAssertion wrapper', () => {
		const { certPem } = getTestSpEncryptionKeyPair();
		const xml = encryptSignedAssertionForSp(signedAssertion, certPem);
		expect(xml).toContain('saml2:EncryptedAssertion');
		expect(xml).toContain('xenc:EncryptedData');
		expect(xml).toContain('aes256-cbc');
		expect(xml).toContain('rsa-oaep-mgf1p');
	});

	it('API-SAML-ENC-UTIL-02: round-trip decrypt restores signed assertion', () => {
		const { certPem, privateKeyPem } = getTestSpEncryptionKeyPair('urn:sp:roundtrip');
		const encrypted = encryptSignedAssertionForSp(signedAssertion, certPem);
		const decrypted = decryptEncryptedAssertion(encrypted, privateKeyPem);
		expect(decrypted).toContain('saml2:Assertion');
		expect(decrypted).toContain('ds:Signature');
	});

	it('API-SAML-ENC-UTIL-03: invalid SP cert PEM throws', () => {
		expect(() => encryptSignedAssertionForSp(signedAssertion, 'not-a-cert')).toThrow(
			SamlAssertionEncryptionError,
		);
	});

	it('API-SAML-ENC-UTIL-04: deprecated rsa-1_5 transport emitted in EncryptedKey', () => {
		const { certPem } = getTestSpEncryptionKeyPair('urn:sp:rsa15');
		const encrypted = encryptSignedAssertionForSp(signedAssertion, certPem, {
			keyTransportAlgorithmId: 'rsa-1_5',
		});
		expect(encrypted).toContain('xmlenc#rsa-1_5');
	});
});
