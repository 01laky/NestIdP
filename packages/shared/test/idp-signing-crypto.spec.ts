import { describe, expect, it } from 'vitest';
import {
	daysFromTodayUntilNotAfter,
	defaultNotAfterCalendarDate,
} from '@shared/idp-cert-common.js';
import {
	assertCompatibleKeyAndSignature,
	defaultSignatureAlgorithmIdForKeyFamily,
	getDefaultGenerateIdpSigningCertRequest,
	getIdpSigningSignatureOption,
	IdpSigningCryptoValidationError,
	IDP_SIGNING_CERT_MAX_VALIDITY_YEARS,
	IDP_SIGNING_SIGNATURE_ALGORITHMS,
	listSignatureOptionsForKeyFamily,
	resolveGenerateIdpSigningCertRequest,
	resolveSignatureAlgorithmIdForSigning,
	toStoredSigningCrypto,
	validateIdpSigningCertNotAfter,
} from '@shared/idp-signing-crypto.js';

describe('idp-signing-crypto', () => {
	it('SH-IDP-CRYPTO-01: validateIdpSigningCertNotAfter min/max boundaries', () => {
		const now = new Date('2026-06-01T12:00:00.000Z');
		expect(validateIdpSigningCertNotAfter('2026-06-01', now)).toBe('2026-06-01');
		expect(() => validateIdpSigningCertNotAfter('2026-05-31', now)).toThrow(/before today/);
		expect(() => validateIdpSigningCertNotAfter('2036-06-02', now)).toThrow(/10 years/);
	});

	it('SH-IDP-CRYPTO-02: assertCompatibleKeyAndSignature rejects cross-family', () => {
		expect(() => assertCompatibleKeyAndSignature('ec', 'rsa-sha256')).toThrow(/not compatible/);
		expect(() => assertCompatibleKeyAndSignature('rsa', 'ecdsa-sha256')).toThrow(/not compatible/);
	});

	it('SH-IDP-CRYPTO-03: all eight algorithm ids resolve', () => {
		for (const entry of IDP_SIGNING_SIGNATURE_ALGORITHMS) {
			expect(getIdpSigningSignatureOption(entry.id)?.id).toBe(entry.id);
		}
	});

	it('SH-IDP-CRYPTO-04: getDefaultGenerateIdpSigningCertRequest matches rsa-2048 / rsa-sha256 / +730d', () => {
		const now = new Date('2026-01-01T00:00:00.000Z');
		const req = getDefaultGenerateIdpSigningCertRequest(now);
		expect(req).toMatchObject({
			keyFamily: 'rsa',
			rsaModulusBits: 2048,
			signatureAlgorithmId: 'rsa-sha256',
		});
		expect(req.notAfter).toBe(defaultNotAfterCalendarDate(now));
		const resolved = resolveGenerateIdpSigningCertRequest(req, now);
		expect(resolved.signatureAlgorithmId).toBe('rsa-sha256');
	});

	it('SH-IDP-CRYPTO-05: notAfter on exact max boundary (10 years) is accepted', () => {
		const now = new Date('2026-06-01T12:00:00.000Z');
		const max = new Date(now);
		max.setUTCFullYear(max.getUTCFullYear() + IDP_SIGNING_CERT_MAX_VALIDITY_YEARS);
		const iso = `${max.getUTCFullYear()}-${String(max.getUTCMonth() + 1).padStart(2, '0')}-${String(max.getUTCDate()).padStart(2, '0')}`;
		expect(validateIdpSigningCertNotAfter(iso, now)).toBe(iso);
	});

	it('SH-IDP-CRYPTO-06: invalid notAfter format and unknown algorithm rejected', () => {
		expect(() => validateIdpSigningCertNotAfter('06/01/2028')).toThrow(
			IdpSigningCryptoValidationError,
		);
		expect(() => assertCompatibleKeyAndSignature('rsa', 'unknown-algo')).toThrow(
			/Unknown signatureAlgorithmId/,
		);
	});

	it('SH-IDP-CRYPTO-07: rsaModulusBits / ecCurve mutual exclusion', () => {
		const now = new Date('2026-06-01T00:00:00.000Z');
		expect(() =>
			resolveGenerateIdpSigningCertRequest(
				{ keyFamily: 'rsa', ecCurve: 'P-256', notAfter: '2028-01-01' },
				now,
			),
		).toThrow(/ecCurve must not be set/);
		expect(() =>
			resolveGenerateIdpSigningCertRequest(
				{ keyFamily: 'ec', rsaModulusBits: 4096, notAfter: '2028-01-01' },
				now,
			),
		).toThrow(/rsaModulusBits must not be set/);
	});

	it('SH-IDP-CRYPTO-08: bad rsaModulusBits and ecCurve values rejected', () => {
		const now = new Date('2026-06-01T00:00:00.000Z');
		expect(() =>
			resolveGenerateIdpSigningCertRequest(
				{ rsaModulusBits: 1024 as never, notAfter: '2028-01-01' },
				now,
			),
		).toThrow(/2048, 3072, or 4096/);
		expect(() =>
			resolveGenerateIdpSigningCertRequest(
				{ keyFamily: 'ec', ecCurve: 'P-192' as never, notAfter: '2028-01-01' },
				now,
			),
		).toThrow(/P-256, P-384, or P-521/);
	});

	it('SH-IDP-CRYPTO-09: listSignatureOptionsForKeyFamily returns four options each', () => {
		expect(listSignatureOptionsForKeyFamily('rsa')).toHaveLength(4);
		expect(listSignatureOptionsForKeyFamily('ec')).toHaveLength(4);
		expect(listSignatureOptionsForKeyFamily('rsa').every((o) => o.keyFamily === 'rsa')).toBe(true);
	});

	it('SH-IDP-CRYPTO-10: daysFromTodayUntilNotAfter is at least one day', () => {
		const now = new Date('2026-06-01T12:00:00.000Z');
		expect(daysFromTodayUntilNotAfter('2026-06-01', now)).toBe(1);
		expect(daysFromTodayUntilNotAfter('2028-06-01', now)).toBeGreaterThan(700);
	});

	it('SH-IDP-CRYPTO-11: EC defaults to ecdsa-sha256 when algorithm omitted', () => {
		const now = new Date('2026-06-01T00:00:00.000Z');
		const resolved = resolveGenerateIdpSigningCertRequest(
			{ keyFamily: 'ec', ecCurve: 'P-384', notAfter: '2029-01-01' },
			now,
		);
		expect(resolved.signatureAlgorithmId).toBe('ecdsa-sha256');
		expect(resolved.ecCurve).toBe('P-384');
	});

	it('SH-IDP-CRYPTO-12: toStoredSigningCrypto nulls RSA fields for EC', () => {
		const now = new Date('2026-06-01T00:00:00.000Z');
		const resolved = resolveGenerateIdpSigningCertRequest(
			{
				keyFamily: 'ec',
				ecCurve: 'P-521',
				signatureAlgorithmId: 'ecdsa-sha512',
				notAfter: '2029-01-01',
			},
			now,
		);
		expect(toStoredSigningCrypto(resolved)).toEqual({
			signingKeyFamily: 'ec',
			signingSignatureAlgorithmId: 'ecdsa-sha512',
			signingRsaModulusBits: null,
			signingEcCurve: 'P-521',
		});
	});

	it('SH-IDP-CRYPTO-13: resolveSignatureAlgorithmIdForSigning falls back for unknown stored id', () => {
		const fallback = resolveSignatureAlgorithmIdForSigning('not-a-real-id');
		expect(fallback.id).toBe('rsa-sha256');
	});

	it('SH-IDP-CRYPTO-14: defaultSignatureAlgorithmIdForKeyFamily per family', () => {
		expect(defaultSignatureAlgorithmIdForKeyFamily('rsa')).toBe('rsa-sha256');
		expect(defaultSignatureAlgorithmIdForKeyFamily('ec')).toBe('ecdsa-sha256');
	});
});
