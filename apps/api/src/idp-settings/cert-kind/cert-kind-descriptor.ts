import type { IdpSettings, Prisma } from '@prisma/client';
import type { StoredEncryptionCrypto, StoredSigningCrypto } from '@nestidp/shared';
import type { CertRotationKind } from '../cert-rotation-notifier';
import { prismaCryptoPendingData, prismaCryptoPrimaryData } from '../utils/idp-cert.util';
import {
	prismaEncryptionPendingData,
	prismaEncryptionPrimaryData,
} from '../utils/idp-encryption-cert.util';

/**
 * Per-kind descriptor that captures every difference between the signing and encryption certificate
 * lifecycles (Prompt 38 §6.6) so the manual-cert methods of `IdpSettingsService` can be collapsed into one
 * kind-parameterised implementation. STAGE A: the pure, behaviour-bearing data/field/message parts only —
 * the Prisma `update.data` fragments for primary write / rotation start / complete / cancel, the
 * active/pending predicates and the conflict messages. The dependency-bound hooks (generate, validate,
 * audit) are wired in when the service methods are migrated (Stage B); this module deliberately touches no
 * injected services, so it is additive and independently unit-tested against the current inline behaviour.
 *
 * The fragments are typed `Prisma.IdpSettingsUncheckedUpdateInput` (flat scalars) — exactly what the
 * service's inline `data: { ... }` objects already are.
 */
type UpdateData = Prisma.IdpSettingsUncheckedUpdateInput;

export interface CertKindConflictMessages {
	/** No primary cert configured yet (start-rotation precondition). */
	readonly needPrimaryFirst: string;
	/** A rotation is already pending (start-rotation precondition). */
	readonly rotationInProgress: string;
	/** A rotation is pending and blocks a new primary write (generate/upload precondition). */
	readonly finishOrCancelFirst: string;
	/** No rotation pending (complete/cancel precondition). */
	readonly noRotationInProgress: string;
}

export interface CertKindDescriptor<TCrypto> {
	readonly kind: CertRotationKind;
	/** True when a usable primary cert+key is stored. */
	hasActive(settings: IdpSettings): boolean;
	/** True when a rotation is pending (either pending cert or pending key present). */
	hasPending(settings: IdpSettings): boolean;
	/** `update.data` to write a new primary cert (generate / upload). */
	primaryData(certPem: string, keyEncrypted: string, crypto: TCrypto): UpdateData;
	/** `update.data` to start a rotation — writes the pending cert/key + the rotation-started timestamp. */
	pendingData(certPem: string, keyEncrypted: string, crypto: TCrypto, startedAt: Date): UpdateData;
	/** `update.data` to complete a rotation — promotes pending→active and clears every pending field. */
	completeData(settings: IdpSettings): UpdateData;
	/** `update.data` to cancel a rotation — clears every pending field. */
	clearPendingData(): UpdateData;
	readonly messages: CertKindConflictMessages;
}

export const SIGNING_DESCRIPTOR: CertKindDescriptor<StoredSigningCrypto> = {
	kind: 'signing',
	hasActive: (s) => Boolean(s.signingCertPem && s.signingKeyEncrypted),
	hasPending: (s) => Boolean(s.pendingSigningCertPem || s.pendingSigningKeyEncrypted),
	primaryData: (certPem, keyEncrypted, crypto) => ({
		signingCertPem: certPem,
		signingKeyEncrypted: keyEncrypted,
		...prismaCryptoPrimaryData(crypto),
	}),
	pendingData: (certPem, keyEncrypted, crypto, startedAt) => ({
		pendingSigningCertPem: certPem,
		pendingSigningKeyEncrypted: keyEncrypted,
		rotationStartedAt: startedAt,
		...prismaCryptoPendingData(crypto),
	}),
	completeData: (s) => ({
		signingCertPem: s.pendingSigningCertPem,
		signingKeyEncrypted: s.pendingSigningKeyEncrypted,
		signingKeyFamily: s.pendingSigningKeyFamily,
		signingSignatureAlgorithmId: s.pendingSigningSignatureAlgorithmId,
		signingRsaModulusBits: s.pendingSigningRsaModulusBits,
		signingEcCurve: s.pendingSigningEcCurve,
		pendingSigningCertPem: null,
		pendingSigningKeyEncrypted: null,
		pendingSigningKeyFamily: null,
		pendingSigningSignatureAlgorithmId: null,
		pendingSigningRsaModulusBits: null,
		pendingSigningEcCurve: null,
		rotationStartedAt: null,
	}),
	clearPendingData: () => ({
		pendingSigningCertPem: null,
		pendingSigningKeyEncrypted: null,
		pendingSigningKeyFamily: null,
		pendingSigningSignatureAlgorithmId: null,
		pendingSigningRsaModulusBits: null,
		pendingSigningEcCurve: null,
		rotationStartedAt: null,
	}),
	messages: {
		needPrimaryFirst: 'Configure or generate primary signing certificate first',
		rotationInProgress: 'Certificate rotation already in progress',
		finishOrCancelFirst: 'Finish or cancel certificate rotation first',
		noRotationInProgress: 'No certificate rotation in progress',
	},
};

export const ENCRYPTION_DESCRIPTOR: CertKindDescriptor<StoredEncryptionCrypto> = {
	kind: 'encryption',
	hasActive: (s) => Boolean(s.encryptionCertPem && s.encryptionKeyEncrypted),
	hasPending: (s) => Boolean(s.pendingEncryptionCertPem || s.pendingEncryptionKeyEncrypted),
	primaryData: (certPem, keyEncrypted, crypto) => ({
		encryptionCertPem: certPem,
		encryptionKeyEncrypted: keyEncrypted,
		...prismaEncryptionPrimaryData(crypto),
	}),
	pendingData: (certPem, keyEncrypted, crypto, startedAt) => ({
		pendingEncryptionCertPem: certPem,
		pendingEncryptionKeyEncrypted: keyEncrypted,
		encryptionRotationStartedAt: startedAt,
		...prismaEncryptionPendingData(crypto),
	}),
	completeData: (s) => ({
		encryptionCertPem: s.pendingEncryptionCertPem,
		encryptionKeyEncrypted: s.pendingEncryptionKeyEncrypted,
		encryptionKeyFamily: s.pendingEncryptionKeyFamily,
		encryptionKeyTransportAlgorithmId: s.pendingEncryptionKeyTransportAlgorithmId,
		encryptionRsaModulusBits: s.pendingEncryptionRsaModulusBits,
		encryptionEcCurve: s.pendingEncryptionEcCurve,
		pendingEncryptionCertPem: null,
		pendingEncryptionKeyEncrypted: null,
		pendingEncryptionKeyFamily: null,
		pendingEncryptionKeyTransportAlgorithmId: null,
		pendingEncryptionRsaModulusBits: null,
		pendingEncryptionEcCurve: null,
		encryptionRotationStartedAt: null,
	}),
	clearPendingData: () => ({
		pendingEncryptionCertPem: null,
		pendingEncryptionKeyEncrypted: null,
		pendingEncryptionKeyFamily: null,
		pendingEncryptionKeyTransportAlgorithmId: null,
		pendingEncryptionRsaModulusBits: null,
		pendingEncryptionEcCurve: null,
		encryptionRotationStartedAt: null,
	}),
	messages: {
		needPrimaryFirst: 'Configure or generate primary encryption certificate first',
		rotationInProgress: 'Encryption certificate rotation already in progress',
		finishOrCancelFirst: 'Finish or cancel encryption certificate rotation first',
		noRotationInProgress: 'No encryption certificate rotation in progress',
	},
};
