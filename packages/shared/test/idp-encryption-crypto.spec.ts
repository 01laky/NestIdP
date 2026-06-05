import { describe, expect, it } from 'vitest';
import {
	assertCompatibleKeyAndKeyTransport,
	getDefaultGenerateIdpEncryptionCertRequest,
	getIdpContentEncryptionOption,
	getIdpEncryptionKeyTransportOption,
	IDP_DEFAULT_CONTENT_ENCRYPTION_ALGORITHM_ID,
	IdpEncryptionCryptoValidationError,
	listKeyTransportOptionsForKeyFamily,
	resolveGenerateIdpEncryptionCertRequest,
	toStoredEncryptionCrypto,
} from '@shared/idp-encryption-crypto.js';
import { validateIdpCertNotAfter } from '@shared/idp-cert-common.js';

describe('idp-encryption-crypto', () => {
	it('SH-IDP-ENC-01: validateIdpCertNotAfter reused for encryption defaults', () => {
		const now = new Date('2026-06-01T12:00:00.000Z');
		expect(() => validateIdpCertNotAfter('2026-05-01', now)).toThrow();
		expect(validateIdpCertNotAfter('2027-06-01', now)).toBe('2027-06-01');
	});

	it('SH-IDP-ENC-02: assertCompatibleKeyAndKeyTransport rejects EC + transport', () => {
		expect(() => assertCompatibleKeyAndKeyTransport('ec', 'rsa-oaep-mgf1p')).toThrow(
			IdpEncryptionCryptoValidationError,
		);
	});

	it('SH-IDP-ENC-03: all 3 transport ids resolve', () => {
		for (const id of ['rsa-oaep-mgf1p', 'rsa-oaep', 'rsa-1_5']) {
			expect(getIdpEncryptionKeyTransportOption(id)?.id).toBe(id);
		}
	});

	it('SH-IDP-ENC-04: getDefaultGenerateIdpEncryptionCertRequest shape', () => {
		const req = getDefaultGenerateIdpEncryptionCertRequest(new Date('2026-01-01T00:00:00.000Z'));
		expect(req.keyFamily).toBe('rsa');
		expect(req.rsaModulusBits).toBe(2048);
		expect(req.keyTransportAlgorithmId).toBe('rsa-oaep-mgf1p');
		expect(req.notAfter).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('SH-IDP-ENC-06: IDP_DEFAULT_CONTENT_ENCRYPTION_ALGORITHM_ID resolves', () => {
		expect(getIdpContentEncryptionOption(IDP_DEFAULT_CONTENT_ENCRYPTION_ALGORITHM_ID)?.id).toBe(
			'aes256-cbc',
		);
	});

	it('SH-IDP-ENC-07: content encryption catalog ids', () => {
		expect(getIdpContentEncryptionOption('aes128-cbc')?.id).toBe('aes128-cbc');
	});

	it('SH-IDP-ENC-02b: listKeyTransportOptionsForKeyFamily empty for ec', () => {
		expect(listKeyTransportOptionsForKeyFamily('ec')).toEqual([]);
	});

	it('SH-IDP-ENC-04b: EC generate resolves null transport', () => {
		const resolved = resolveGenerateIdpEncryptionCertRequest({
			keyFamily: 'ec',
			ecCurve: 'P-384',
		});
		expect(resolved.keyTransportAlgorithmId).toBeNull();
		expect(toStoredEncryptionCrypto(resolved).encryptionEcCurve).toBe('P-384');
	});

	it('SH-IDP-ENC-05: RSA transport with RSA key family is compatible', () => {
		expect(() => assertCompatibleKeyAndKeyTransport('rsa', 'rsa-oaep-mgf1p')).not.toThrow();
	});

	it('SH-IDP-ENC-08: unknown transport id throws', () => {
		expect(() =>
			resolveGenerateIdpEncryptionCertRequest({ keyTransportAlgorithmId: 'nope' }),
		).toThrow(IdpEncryptionCryptoValidationError);
	});

	it('SH-IDP-ENC-09: invalid rsaModulusBits throws', () => {
		expect(() =>
			resolveGenerateIdpEncryptionCertRequest({ rsaModulusBits: 1024 as never }),
		).toThrow(IdpEncryptionCryptoValidationError);
	});

	it('SH-IDP-ENC-10: invalid ecCurve throws', () => {
		expect(() =>
			resolveGenerateIdpEncryptionCertRequest({ keyFamily: 'ec', ecCurve: 'P-999' as never }),
		).toThrow(IdpEncryptionCryptoValidationError);
	});

	it('SH-IDP-ENC-11: rsaModulusBits rejected for EC family', () => {
		expect(() =>
			resolveGenerateIdpEncryptionCertRequest({
				keyFamily: 'ec',
				ecCurve: 'P-256',
				rsaModulusBits: 2048,
			}),
		).toThrow(IdpEncryptionCryptoValidationError);
	});
});
