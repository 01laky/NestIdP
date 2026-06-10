import type { IdpSettings } from '@prisma/client';
import type {
	AdminDashboardEncryptionCertStatus,
	AdminDashboardIdpCertStatus,
	AdminDashboardIdpStatusDto,
	IdpCertEcCurve,
	IdpMetadataUrlResponseDto,
	IdpSettingsPublicDto,
} from '@nestidp/shared';
import type { IdpAutoRotationStatusDto } from '@nestidp/shared';
import {
	CERT_ROTATION_DEFAULT_LEAD_DAYS,
	CERT_ROTATION_DEFAULT_OVERLAP_DAYS,
	IDP_CERT_EXPIRY_WARNING_DAYS,
	IDP_SETTINGS_ROUTE_PREFIX,
	MS_PER_DAY,
	SAML_METADATA_PATH,
	SAML_SSO_PATH,
} from '@nestidp/shared';
import {
	fingerprintSha256Hex,
	isCertExpiringSoon,
	parseCertNotAfterIso,
} from '../utils/idp-cert.util';

/**
 * Fingerprint a cert for the public DTO, tolerating a null or unparseable PEM (returns null) — mirrors
 * the defensive `parseCertNotAfterIso`. A corrupted stored cert must never make `GET /idp/settings` or
 * the auto-rotation check throw a 500.
 */
function safeFingerprintSha256Hex(certPem: string | null): string | null {
	if (!certPem) {
		return null;
	}
	try {
		return fingerprintSha256Hex(certPem);
	} catch {
		return null;
	}
}

export function resolveIdpBaseUrl(idpBaseUrl: string): string {
	return idpBaseUrl.replace(/\/+$/, '');
}

export function buildIdpUrls(idpBaseUrl: string): {
	metadataUrl: string;
	ssoUrl: string;
	idpBaseUrl: string;
} {
	const base = resolveIdpBaseUrl(idpBaseUrl);
	return {
		idpBaseUrl: base,
		metadataUrl: `${base}${SAML_METADATA_PATH}`,
		ssoUrl: `${base}${SAML_SSO_PATH}`,
	};
}

export function buildMetadataUrlResponse(
	settings: IdpSettings,
	idpBaseUrl: string,
): IdpMetadataUrlResponseDto {
	const urls = buildIdpUrls(idpBaseUrl);
	return {
		metadataUrl: urls.metadataUrl,
		entityId: settings.entityId,
		ssoUrl: urls.ssoUrl,
	};
}

export function deriveCertStatus(settings: IdpSettings): AdminDashboardIdpCertStatus {
	if (settings.pendingSigningCertPem || settings.pendingSigningKeyEncrypted) {
		return 'rotation_active';
	}
	if (!settings.signingCertPem || !settings.signingKeyEncrypted) {
		return 'missing';
	}
	const notAfter = parseCertNotAfterIso(settings.signingCertPem);
	if (isCertExpiringSoon(notAfter, IDP_CERT_EXPIRY_WARNING_DAYS)) {
		return 'expiring_soon';
	}
	return 'ok';
}

export function deriveEncryptionCertStatus(
	settings: IdpSettings,
): AdminDashboardEncryptionCertStatus {
	if (settings.pendingEncryptionCertPem || settings.pendingEncryptionKeyEncrypted) {
		return 'rotation_active';
	}
	if (!settings.encryptionCertPem || !settings.encryptionKeyEncrypted) {
		return 'not_configured';
	}
	const notAfter = parseCertNotAfterIso(settings.encryptionCertPem);
	if (isCertExpiringSoon(notAfter, IDP_CERT_EXPIRY_WARNING_DAYS)) {
		return 'expiring_soon';
	}
	return 'ok';
}

function mapEncryptionCryptoFields(settings: IdpSettings): {
	encryptionKeyFamily: 'rsa' | 'ec' | null;
	encryptionKeyTransportAlgorithmId: string | null;
	encryptionRsaModulusBits: number | null;
	encryptionEcCurve: IdpCertEcCurve | null;
} {
	return {
		encryptionKeyFamily: (settings.encryptionKeyFamily as 'rsa' | 'ec' | null) ?? null,
		encryptionKeyTransportAlgorithmId: settings.encryptionKeyTransportAlgorithmId ?? null,
		encryptionRsaModulusBits: settings.encryptionRsaModulusBits ?? null,
		encryptionEcCurve: (settings.encryptionEcCurve as IdpCertEcCurve | null) ?? null,
	};
}

function mapSigningCryptoFields(settings: IdpSettings): {
	signingKeyFamily: 'rsa' | 'ec' | null;
	signingSignatureAlgorithmId: string | null;
	signingRsaModulusBits: number | null;
	signingEcCurve: IdpCertEcCurve | null;
} {
	return {
		signingKeyFamily: (settings.signingKeyFamily as 'rsa' | 'ec' | null) ?? null,
		signingSignatureAlgorithmId: settings.signingSignatureAlgorithmId ?? null,
		signingRsaModulusBits: settings.signingRsaModulusBits ?? null,
		signingEcCurve: (settings.signingEcCurve as IdpCertEcCurve | null) ?? null,
	};
}

export function toDashboardIdpStatus(settings: IdpSettings): AdminDashboardIdpStatusDto {
	const rotationActive = Boolean(
		settings.pendingSigningCertPem || settings.pendingSigningKeyEncrypted,
	);
	const encryptionRotationActive = Boolean(
		settings.pendingEncryptionCertPem || settings.pendingEncryptionKeyEncrypted,
	);
	const crypto = mapSigningCryptoFields(settings);
	const encryptionCrypto = mapEncryptionCryptoFields(settings);
	return {
		idpSettingsRoute: IDP_SETTINGS_ROUTE_PREFIX,
		hasSigningCertificate: Boolean(settings.signingCertPem && settings.signingKeyEncrypted),
		rotationActive,
		signingCertNotAfter: parseCertNotAfterIso(settings.signingCertPem),
		...crypto,
		certStatus: deriveCertStatus(settings),
		hasEncryptionCertificate: Boolean(
			settings.encryptionCertPem && settings.encryptionKeyEncrypted,
		),
		encryptionRotationActive,
		encryptionCertNotAfter: parseCertNotAfterIso(settings.encryptionCertPem),
		...encryptionCrypto,
		encryptionCertStatus: deriveEncryptionCertStatus(settings),
	};
}

/** Resolved per-kind auto-rotation lead/overlap windows (in days), reflecting any env overrides. */
export interface IdpAutoRotationDays {
	signing: { leadDays: number; overlapDays: number };
	encryption: { leadDays: number; overlapDays: number };
}

/** Fallback windows = the shared defaults; used when no resolved config is threaded in (e.g. unit tests). */
const DEFAULT_ROTATION_DAYS: IdpAutoRotationDays = {
	signing: {
		leadDays: CERT_ROTATION_DEFAULT_LEAD_DAYS,
		overlapDays: CERT_ROTATION_DEFAULT_OVERLAP_DAYS,
	},
	encryption: {
		leadDays: CERT_ROTATION_DEFAULT_LEAD_DAYS,
		overlapDays: CERT_ROTATION_DEFAULT_OVERLAP_DAYS,
	},
};

/**
 * Compute the non-secret auto-rotation status for one cert. `willAutoStartBy` / `willAutoCompleteAt` use
 * the resolved lead/overlap days for the kind (threaded from {@link CertRotationConfig} by the service), so
 * the projection stays correct when an operator overrides the per-cert env knobs (Prompt 38 §B9).
 */
function buildAutoRotationStatus(opts: {
	enabled: boolean;
	disabledAt: Date | null;
	consecutiveFailures: number;
	lastError: string | null;
	activeNotAfter: string | null;
	rotationActive: boolean;
	rotationStartedAt: Date | null;
	leadDays: number;
	overlapDays: number;
}): IdpAutoRotationStatusDto {
	const live = opts.enabled && !opts.disabledAt;
	let willAutoStartBy: string | null = null;
	if (live && !opts.rotationActive && opts.activeNotAfter) {
		willAutoStartBy = new Date(
			new Date(opts.activeNotAfter).getTime() - opts.leadDays * MS_PER_DAY,
		).toISOString();
	}
	let willAutoCompleteAt: string | null = null;
	if (live && opts.rotationActive && opts.rotationStartedAt) {
		willAutoCompleteAt = new Date(
			opts.rotationStartedAt.getTime() + opts.overlapDays * MS_PER_DAY,
		).toISOString();
	}
	return {
		enabled: opts.enabled,
		disabledAt: opts.disabledAt?.toISOString() ?? null,
		consecutiveFailures: opts.consecutiveFailures,
		lastError: opts.lastError,
		willAutoStartBy,
		willAutoCompleteAt,
	};
}

export function toIdpSettingsPublicDto(
	settings: IdpSettings,
	idpBaseUrl: string,
	rotationDays: IdpAutoRotationDays = DEFAULT_ROTATION_DAYS,
): IdpSettingsPublicDto {
	const urls = buildIdpUrls(idpBaseUrl);
	const rotationActive = Boolean(
		settings.pendingSigningCertPem || settings.pendingSigningKeyEncrypted,
	);
	const encryptionRotationActive = Boolean(
		settings.pendingEncryptionCertPem || settings.pendingEncryptionKeyEncrypted,
	);
	const crypto = mapSigningCryptoFields(settings);
	const encryptionCrypto = mapEncryptionCryptoFields(settings);
	return {
		entityId: settings.entityId,
		nameIdFormat: settings.nameIdFormat,
		wantAuthnRequestsSigned: settings.wantAuthnRequestsSigned,
		hasSigningCertificate: Boolean(settings.signingCertPem && settings.signingKeyEncrypted),
		signingCertFingerprintSha256: safeFingerprintSha256Hex(settings.signingCertPem),
		signingCertNotAfter: parseCertNotAfterIso(settings.signingCertPem),
		...crypto,
		hasEncryptionCertificate: Boolean(
			settings.encryptionCertPem && settings.encryptionKeyEncrypted,
		),
		encryptionCertFingerprintSha256: safeFingerprintSha256Hex(settings.encryptionCertPem),
		encryptionCertNotAfter: parseCertNotAfterIso(settings.encryptionCertPem),
		...encryptionCrypto,
		metadataUrl: urls.metadataUrl,
		ssoUrl: urls.ssoUrl,
		idpBaseUrl: urls.idpBaseUrl,
		rotation: {
			active: rotationActive,
			startedAt: settings.rotationStartedAt?.toISOString() ?? null,
			hasPendingCertificate: Boolean(settings.pendingSigningCertPem),
			pendingCertFingerprintSha256: safeFingerprintSha256Hex(settings.pendingSigningCertPem),
			pendingSigningKeyFamily: (settings.pendingSigningKeyFamily as 'rsa' | 'ec' | null) ?? null,
			pendingSigningSignatureAlgorithmId: settings.pendingSigningSignatureAlgorithmId ?? null,
			pendingSigningRsaModulusBits: settings.pendingSigningRsaModulusBits ?? null,
			pendingSigningEcCurve:
				(settings.pendingSigningEcCurve as 'P-256' | 'P-384' | 'P-521' | null) ?? null,
			pendingSigningCertNotAfter: parseCertNotAfterIso(settings.pendingSigningCertPem),
			auto: buildAutoRotationStatus({
				enabled: settings.autoRotateSigningEnabled,
				disabledAt: settings.signingAutoRotationDisabledAt,
				consecutiveFailures: settings.signingAutoRotationConsecutiveFailures,
				lastError: settings.signingAutoRotationLastError,
				activeNotAfter: parseCertNotAfterIso(settings.signingCertPem),
				rotationActive,
				rotationStartedAt: settings.rotationStartedAt,
				leadDays: rotationDays.signing.leadDays,
				overlapDays: rotationDays.signing.overlapDays,
			}),
		},
		encryptionRotation: {
			active: encryptionRotationActive,
			startedAt: settings.encryptionRotationStartedAt?.toISOString() ?? null,
			hasPendingCertificate: Boolean(settings.pendingEncryptionCertPem),
			pendingCertFingerprintSha256: safeFingerprintSha256Hex(settings.pendingEncryptionCertPem),
			pendingEncryptionKeyFamily:
				(settings.pendingEncryptionKeyFamily as 'rsa' | 'ec' | null) ?? null,
			pendingEncryptionKeyTransportAlgorithmId:
				settings.pendingEncryptionKeyTransportAlgorithmId ?? null,
			pendingEncryptionRsaModulusBits: settings.pendingEncryptionRsaModulusBits ?? null,
			pendingEncryptionEcCurve:
				(settings.pendingEncryptionEcCurve as 'P-256' | 'P-384' | 'P-521' | null) ?? null,
			pendingEncryptionCertNotAfter: parseCertNotAfterIso(settings.pendingEncryptionCertPem),
			auto: buildAutoRotationStatus({
				enabled: settings.autoRotateEncryptionEnabled,
				disabledAt: settings.encryptionAutoRotationDisabledAt,
				consecutiveFailures: settings.encryptionAutoRotationConsecutiveFailures,
				lastError: settings.encryptionAutoRotationLastError,
				activeNotAfter: parseCertNotAfterIso(settings.encryptionCertPem),
				rotationActive: encryptionRotationActive,
				rotationStartedAt: settings.encryptionRotationStartedAt,
				leadDays: rotationDays.encryption.leadDays,
				overlapDays: rotationDays.encryption.overlapDays,
			}),
		},
		lastAutoRotationCheckAt: settings.lastAutoRotationCheckAt?.toISOString() ?? null,
		lastAutoRotationActionAt: settings.lastAutoRotationActionAt?.toISOString() ?? null,
		updatedAt: settings.updatedAt.toISOString(),
	};
}
