import {
	assertValidSigningCertPem,
	assertValidSigningPrivateKeyPem,
	fingerprintSha256Hex,
	inferStoredSigningCryptoFromPem,
	isCertExpiringSoon,
	namedCurveToLabel,
	parseCertNotAfterIso,
	validateSigningCertPair,
	IdpCertValidationError,
} from '@api/idp-settings/utils/idp-cert.util';
import { assertMatchingKeyPair } from '@test/support/crypto/test-cert.util';
import { ConfigService } from '@nestjs/config';
import { getTestSigningMaterial } from '@test/support/prisma/test-fixtures';
import { IdpSigningService } from '@api/saml/services/idp-signing.service';
import { SamlAuthAuditService } from '@api/saml/services/saml-auth-audit.service';

describe('idp-cert.util', () => {
	let certPem: string;
	let privateKeyPem: string;

	beforeAll(() => {
		const material = getTestSigningMaterial('http://localhost:3000');
		certPem = material.certPem;
		privateKeyPem = material.privateKeyPem;
	});

	it('API-IDP-VAL-01: assertValidSigningCertPem accepts PEM', () => {
		expect(assertValidSigningCertPem(certPem)).toBe(certPem.trim());
	});

	it('API-IDP-VAL-02: assertValidSigningCertPem rejects empty', () => {
		expect(() => assertValidSigningCertPem('   ')).toThrow(IdpCertValidationError);
	});

	it('API-IDP-VAL-03: assertValidSigningCertPem rejects non-PEM', () => {
		expect(() => assertValidSigningCertPem('not-pem')).toThrow('valid PEM certificate');
	});

	it('API-IDP-VAL-04: assertValidSigningPrivateKeyPem accepts key', () => {
		expect(assertValidSigningPrivateKeyPem(privateKeyPem)).toBe(privateKeyPem.trim());
	});

	it('API-IDP-VAL-05: assertValidSigningPrivateKeyPem rejects garbage', () => {
		expect(() => assertValidSigningPrivateKeyPem('nope')).toThrow('valid PEM private key');
	});

	it('API-IDP-VAL-06: assertMatchingKeyPair accepts matching pair', () => {
		expect(() => assertMatchingKeyPair(certPem, privateKeyPem)).not.toThrow();
	});

	it('API-IDP-VAL-07: assertMatchingKeyPair rejects mismatched key', () => {
		const other = getTestSigningMaterial('https://other-key.example.com');
		expect(() => assertMatchingKeyPair(certPem, other.privateKeyPem)).toThrow('do not match');
	});

	it('API-IDP-VAL-08: validateSigningCertPair returns trimmed PEMs', () => {
		const result = validateSigningCertPair(`  ${certPem}  `, `  ${privateKeyPem}  `);
		expect(result.certPem).toBe(certPem.trim());
		expect(result.privateKeyPem).toBe(privateKeyPem.trim());
	});

	it('API-IDP-VAL-09: fingerprintSha256Hex is stable hex', () => {
		const fp = fingerprintSha256Hex(certPem);
		expect(fp).toMatch(/^[a-f0-9]{64}$/);
		expect(fingerprintSha256Hex(certPem)).toBe(fp);
	});

	it('API-IDP-VAL-10: parseCertNotAfterIso returns ISO string', () => {
		const iso = parseCertNotAfterIso(certPem);
		expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('API-IDP-VAL-11: parseCertNotAfterIso null for missing cert', () => {
		expect(parseCertNotAfterIso(null)).toBeNull();
		expect(parseCertNotAfterIso(undefined)).toBeNull();
	});

	it('API-IDP-VAL-12: isCertExpiringSoon true within window', () => {
		const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
		expect(isCertExpiringSoon(soon, 30)).toBe(true);
	});

	it('API-IDP-VAL-13: isCertExpiringSoon false for distant expiry', () => {
		const far = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString();
		expect(isCertExpiringSoon(far, 30)).toBe(false);
	});

	it('API-IDP-VAL-14: rejects oversized PEM', () => {
		const huge = `-----BEGIN CERTIFICATE-----\n${'A'.repeat(20_000)}\n-----END CERTIFICATE-----`;
		expect(() => assertValidSigningCertPem(huge)).toThrow('too large');
	});

	it('API-IDP-VAL-15: inferStoredSigningCryptoFromPem returns rsa defaults for RSA pair', () => {
		const crypto = inferStoredSigningCryptoFromPem(certPem, privateKeyPem);
		expect(crypto.signingKeyFamily).toBe('rsa');
		expect(crypto.signingSignatureAlgorithmId).toBe('rsa-sha256');
		expect(crypto.signingRsaModulusBits).toBeGreaterThanOrEqual(2048);
		expect(crypto.signingEcCurve).toBeNull();
	});

	it('API-IDP-VAL-16: validateSigningCertPair includes crypto metadata', () => {
		const result = validateSigningCertPair(certPem, privateKeyPem);
		expect(result.crypto.signingKeyFamily).toBe('rsa');
	});

	it('API-IDP-VAL-17: inferStoredSigningCryptoFromPem detects EC material', () => {
		const signing = new IdpSigningService(
			{} as never,
			{} as never,
			{ get: () => undefined } as unknown as ConfigService,
			new SamlAuthAuditService({ recordSafe: jest.fn() } as never),
		);
		const ec = signing.generateKeyPairAndCert('https://ec-infer.example', {
			keyFamily: 'ec',
			ecCurve: 'P-256',
			signatureAlgorithmId: 'ecdsa-sha256',
			notAfter: '2030-01-01',
		});
		const crypto = inferStoredSigningCryptoFromPem(ec.certPem, ec.privateKeyPem);
		expect(crypto.signingKeyFamily).toBe('ec');
		expect(crypto.signingEcCurve).toBe('P-256');
		expect(crypto.signingRsaModulusBits).toBeNull();
	});

	it('API-IDP-VAL-18: mismatched RSA cert and EC key rejected', () => {
		const signing = new IdpSigningService(
			{} as never,
			{} as never,
			{ get: () => undefined } as unknown as ConfigService,
			new SamlAuthAuditService({ recordSafe: jest.fn() } as never),
		);
		const ec = signing.generateKeyPairAndCert('https://ec-mismatch.example', {
			keyFamily: 'ec',
			notAfter: '2030-01-01',
		});
		expect(() => inferStoredSigningCryptoFromPem(certPem, ec.privateKeyPem)).toThrow(
			/different key types/,
		);
	});

	it('API-IDP-VAL-19: namedCurveToLabel maps the three supported OpenSSL curve names (§B8)', () => {
		expect(namedCurveToLabel('prime256v1')).toBe('P-256');
		expect(namedCurveToLabel('secp384r1')).toBe('P-384');
		expect(namedCurveToLabel('secp521r1')).toBe('P-521');
	});

	it('API-IDP-VAL-20: namedCurveToLabel throws on an unknown/missing curve instead of defaulting to P-256 (§B8)', () => {
		expect(() => namedCurveToLabel('secp256k1')).toThrow(IdpCertValidationError);
		expect(() => namedCurveToLabel('secp256k1')).toThrow(/Unsupported EC curve 'secp256k1'/);
		expect(() => namedCurveToLabel(undefined)).toThrow(IdpCertValidationError);
	});
});
