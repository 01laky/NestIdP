import type { IdpSettings } from '@prisma/client';
import type { StoredEncryptionCrypto, StoredSigningCrypto } from '@nestidp/shared';
import {
	ENCRYPTION_DESCRIPTOR,
	SIGNING_DESCRIPTOR,
} from '@api/idp-settings/cert-kind/cert-kind-descriptor';

/**
 * Locks each cert-kind descriptor's Prisma `update.data` fragments to the EXACT objects the current
 * `IdpSettingsService` writes inline (Prompt 38 §6.6 Stage A). Cert rotation is security-critical — a
 * single swapped field would silently corrupt key handling — so these golden assertions must stay green
 * across the Stage B service migration.
 */
const signingCrypto: StoredSigningCrypto = {
	signingKeyFamily: 'rsa',
	signingSignatureAlgorithmId: 'rsa-sha256',
	signingRsaModulusBits: 2048,
	signingEcCurve: null,
};

const encryptionCrypto: StoredEncryptionCrypto = {
	encryptionKeyFamily: 'rsa',
	encryptionKeyTransportAlgorithmId: 'rsa-oaep-mgf1p',
	encryptionRsaModulusBits: 3072,
	encryptionEcCurve: null,
};

const startedAt = new Date('2026-06-10T00:00:00.000Z');

/** A settings row mid-rotation for both kinds, only the fields the descriptors read. */
const pendingSettings = {
	pendingSigningCertPem: 'PENDING-SIGN-CERT',
	pendingSigningKeyEncrypted: 'PENDING-SIGN-KEY',
	pendingSigningKeyFamily: 'ec',
	pendingSigningSignatureAlgorithmId: 'ecdsa-sha384',
	pendingSigningRsaModulusBits: null,
	pendingSigningEcCurve: 'P-384',
	pendingEncryptionCertPem: 'PENDING-ENC-CERT',
	pendingEncryptionKeyEncrypted: 'PENDING-ENC-KEY',
	pendingEncryptionKeyFamily: 'rsa',
	pendingEncryptionKeyTransportAlgorithmId: 'rsa-oaep-mgf1p',
	pendingEncryptionRsaModulusBits: 4096,
	pendingEncryptionEcCurve: null,
	signingCertPem: 'ACTIVE-SIGN-CERT',
	signingKeyEncrypted: 'ACTIVE-SIGN-KEY',
	encryptionCertPem: 'ACTIVE-ENC-CERT',
	encryptionKeyEncrypted: 'ACTIVE-ENC-KEY',
} as unknown as IdpSettings;

describe('SIGNING_DESCRIPTOR (§6.6 Stage A)', () => {
	it('CKD-SIGN-01: kind + active/pending predicates', () => {
		expect(SIGNING_DESCRIPTOR.kind).toBe('signing');
		expect(SIGNING_DESCRIPTOR.hasActive(pendingSettings)).toBe(true);
		expect(SIGNING_DESCRIPTOR.hasPending(pendingSettings)).toBe(true);
		expect(SIGNING_DESCRIPTOR.hasActive({} as IdpSettings)).toBe(false);
		expect(SIGNING_DESCRIPTOR.hasPending({} as IdpSettings)).toBe(false);
	});

	it('CKD-SIGN-02: primaryData matches the generate/upload inline write', () => {
		expect(SIGNING_DESCRIPTOR.primaryData('CERT', 'ENCKEY', signingCrypto)).toEqual({
			signingCertPem: 'CERT',
			signingKeyEncrypted: 'ENCKEY',
			signingKeyFamily: 'rsa',
			signingSignatureAlgorithmId: 'rsa-sha256',
			signingRsaModulusBits: 2048,
			signingEcCurve: null,
		});
	});

	it('CKD-SIGN-03: pendingData matches the startRotation inline write', () => {
		expect(SIGNING_DESCRIPTOR.pendingData('CERT', 'ENCKEY', signingCrypto, startedAt)).toEqual({
			pendingSigningCertPem: 'CERT',
			pendingSigningKeyEncrypted: 'ENCKEY',
			rotationStartedAt: startedAt,
			pendingSigningKeyFamily: 'rsa',
			pendingSigningSignatureAlgorithmId: 'rsa-sha256',
			pendingSigningRsaModulusBits: 2048,
			pendingSigningEcCurve: null,
		});
	});

	it('CKD-SIGN-04: completeData promotes pending→active and clears pending', () => {
		expect(SIGNING_DESCRIPTOR.completeData(pendingSettings)).toEqual({
			signingCertPem: 'PENDING-SIGN-CERT',
			signingKeyEncrypted: 'PENDING-SIGN-KEY',
			signingKeyFamily: 'ec',
			signingSignatureAlgorithmId: 'ecdsa-sha384',
			signingRsaModulusBits: null,
			signingEcCurve: 'P-384',
			pendingSigningCertPem: null,
			pendingSigningKeyEncrypted: null,
			pendingSigningKeyFamily: null,
			pendingSigningSignatureAlgorithmId: null,
			pendingSigningRsaModulusBits: null,
			pendingSigningEcCurve: null,
			rotationStartedAt: null,
		});
	});

	it('CKD-SIGN-05: clearPendingData matches the cancelRotation inline write', () => {
		expect(SIGNING_DESCRIPTOR.clearPendingData()).toEqual({
			pendingSigningCertPem: null,
			pendingSigningKeyEncrypted: null,
			pendingSigningKeyFamily: null,
			pendingSigningSignatureAlgorithmId: null,
			pendingSigningRsaModulusBits: null,
			pendingSigningEcCurve: null,
			rotationStartedAt: null,
		});
	});

	it('CKD-SIGN-06: conflict messages match the current literals', () => {
		expect(SIGNING_DESCRIPTOR.messages).toEqual({
			needPrimaryFirst: 'Configure or generate primary signing certificate first',
			rotationInProgress: 'Certificate rotation already in progress',
			finishOrCancelFirst: 'Finish or cancel certificate rotation first',
			noRotationInProgress: 'No certificate rotation in progress',
		});
	});
});

describe('ENCRYPTION_DESCRIPTOR (§6.6 Stage A)', () => {
	it('CKD-ENC-01: kind + active/pending predicates', () => {
		expect(ENCRYPTION_DESCRIPTOR.kind).toBe('encryption');
		expect(ENCRYPTION_DESCRIPTOR.hasActive(pendingSettings)).toBe(true);
		expect(ENCRYPTION_DESCRIPTOR.hasPending(pendingSettings)).toBe(true);
		expect(ENCRYPTION_DESCRIPTOR.hasActive({} as IdpSettings)).toBe(false);
		expect(ENCRYPTION_DESCRIPTOR.hasPending({} as IdpSettings)).toBe(false);
	});

	it('CKD-ENC-02: primaryData matches the generate/upload inline write', () => {
		expect(ENCRYPTION_DESCRIPTOR.primaryData('CERT', 'ENCKEY', encryptionCrypto)).toEqual({
			encryptionCertPem: 'CERT',
			encryptionKeyEncrypted: 'ENCKEY',
			encryptionKeyFamily: 'rsa',
			encryptionKeyTransportAlgorithmId: 'rsa-oaep-mgf1p',
			encryptionRsaModulusBits: 3072,
			encryptionEcCurve: null,
		});
	});

	it('CKD-ENC-03: pendingData matches the startEncryptionRotation inline write', () => {
		expect(
			ENCRYPTION_DESCRIPTOR.pendingData('CERT', 'ENCKEY', encryptionCrypto, startedAt),
		).toEqual({
			pendingEncryptionCertPem: 'CERT',
			pendingEncryptionKeyEncrypted: 'ENCKEY',
			encryptionRotationStartedAt: startedAt,
			pendingEncryptionKeyFamily: 'rsa',
			pendingEncryptionKeyTransportAlgorithmId: 'rsa-oaep-mgf1p',
			pendingEncryptionRsaModulusBits: 3072,
			pendingEncryptionEcCurve: null,
		});
	});

	it('CKD-ENC-04: completeData promotes pending→active and clears pending', () => {
		expect(ENCRYPTION_DESCRIPTOR.completeData(pendingSettings)).toEqual({
			encryptionCertPem: 'PENDING-ENC-CERT',
			encryptionKeyEncrypted: 'PENDING-ENC-KEY',
			encryptionKeyFamily: 'rsa',
			encryptionKeyTransportAlgorithmId: 'rsa-oaep-mgf1p',
			encryptionRsaModulusBits: 4096,
			encryptionEcCurve: null,
			pendingEncryptionCertPem: null,
			pendingEncryptionKeyEncrypted: null,
			pendingEncryptionKeyFamily: null,
			pendingEncryptionKeyTransportAlgorithmId: null,
			pendingEncryptionRsaModulusBits: null,
			pendingEncryptionEcCurve: null,
			encryptionRotationStartedAt: null,
		});
	});

	it('CKD-ENC-05: clearPendingData matches the cancelEncryptionRotation inline write', () => {
		expect(ENCRYPTION_DESCRIPTOR.clearPendingData()).toEqual({
			pendingEncryptionCertPem: null,
			pendingEncryptionKeyEncrypted: null,
			pendingEncryptionKeyFamily: null,
			pendingEncryptionKeyTransportAlgorithmId: null,
			pendingEncryptionRsaModulusBits: null,
			pendingEncryptionEcCurve: null,
			encryptionRotationStartedAt: null,
		});
	});

	it('CKD-ENC-06: conflict messages match the current literals', () => {
		expect(ENCRYPTION_DESCRIPTOR.messages).toEqual({
			needPrimaryFirst: 'Configure or generate primary encryption certificate first',
			rotationInProgress: 'Encryption certificate rotation already in progress',
			finishOrCancelFirst: 'Finish or cancel encryption certificate rotation first',
			noRotationInProgress: 'No encryption certificate rotation in progress',
		});
	});
});
