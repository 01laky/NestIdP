import {
	assertEncryptionCertDiffersFromSigningPrimary,
	assertEncryptionCertNotSigningOnly,
	certHasEncryptionKeyUsage,
	generateTestRsaEncryptionCert,
	inferStoredEncryptionCryptoFromPem,
	isSigningOnlyCertPair,
	validateEncryptionKeyPair,
} from '@api/idp-settings/utils/idp-encryption-cert.util';
import { getTestSigningMaterial } from '@test/support/prisma/test-fixtures';

describe('idp-encryption-cert.util', () => {
	it('API-ENC-UTIL-01: generateTestRsaEncryptionCert has encryption keyUsage', () => {
		const { certPem } = generateTestRsaEncryptionCert('https://enc-util.example.com');
		expect(certHasEncryptionKeyUsage(certPem)).toBe(true);
	});

	it('API-ENC-UTIL-02: signing-only pair detected via isSigningOnlyCertPair', () => {
		const { certPem, privateKeyPem } = getTestSigningMaterial('https://sign-only.example.com');
		expect(isSigningOnlyCertPair(certPem, privateKeyPem)).toBe(true);
		expect(() => assertEncryptionCertNotSigningOnly(certPem)).toThrow();
	});

	it('API-ENC-UTIL-03: validateEncryptionKeyPair infers rsa-oaep-mgf1p default transport', () => {
		const { certPem, privateKeyPem } = generateTestRsaEncryptionCert(
			'https://enc-default.example.com',
		);
		const { crypto } = validateEncryptionKeyPair(certPem, privateKeyPem);
		expect(crypto.encryptionKeyFamily).toBe('rsa');
		expect(crypto.encryptionKeyTransportAlgorithmId).toBe('rsa-oaep-mgf1p');
		expect(crypto.encryptionRsaModulusBits).toBe(2048);
	});

	it('API-ENC-UTIL-04: assertEncryptionCertDiffersFromSigningPrimary rejects same fingerprint', () => {
		const { certPem, privateKeyPem } = generateTestRsaEncryptionCert('https://enc-a.example.com');
		const signing = getTestSigningMaterial('https://sign-b.example.com');
		expect(() =>
			assertEncryptionCertDiffersFromSigningPrimary(signing.certPem, signing.certPem),
		).toThrow();
		expect(() =>
			assertEncryptionCertDiffersFromSigningPrimary(certPem, signing.certPem),
		).not.toThrow();
		void privateKeyPem;
	});

	it('API-ENC-UTIL-05: mismatched encryption cert and key → error', () => {
		const a = generateTestRsaEncryptionCert('https://enc-mismatch-a.example.com');
		const b = generateTestRsaEncryptionCert('https://enc-mismatch-b.example.com');
		expect(() => inferStoredEncryptionCryptoFromPem(a.certPem, b.privateKeyPem)).toThrow();
	});

	it('API-ENC-UTIL-06: validateEncryptionKeyPair rejects signing PEM as encryption upload', () => {
		const { certPem, privateKeyPem } = getTestSigningMaterial('https://sign-upload.example.com');
		expect(() => validateEncryptionKeyPair(certPem, privateKeyPem)).toThrow();
	});
});
