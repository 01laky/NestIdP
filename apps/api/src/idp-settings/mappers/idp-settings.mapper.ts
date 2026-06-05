import type { IdpSettings } from '@prisma/client';
import type {
	AdminDashboardEncryptionCertStatus,
	AdminDashboardIdpCertStatus,
	AdminDashboardIdpStatusDto,
	IdpCertEcCurve,
	IdpMetadataUrlResponseDto,
	IdpSettingsPublicDto,
} from '@nestidp/shared';
import {
	IDP_CERT_EXPIRY_WARNING_DAYS,
	IDP_SETTINGS_ROUTE_PREFIX,
	SAML_METADATA_PATH,
	SAML_SSO_PATH,
} from '@nestidp/shared';
import { fingerprintSha256Hex, isCertExpiringSoon, parseCertNotAfterIso } from '../utils/idp-cert.util';

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

export function toIdpSettingsPublicDto(
	settings: IdpSettings,
	idpBaseUrl: string,
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
		hasSigningCertificate: Boolean(settings.signingCertPem && settings.signingKeyEncrypted),
		signingCertFingerprintSha256: settings.signingCertPem
			? fingerprintSha256Hex(settings.signingCertPem)
			: null,
		signingCertNotAfter: parseCertNotAfterIso(settings.signingCertPem),
		...crypto,
		hasEncryptionCertificate: Boolean(
			settings.encryptionCertPem && settings.encryptionKeyEncrypted,
		),
		encryptionCertFingerprintSha256: settings.encryptionCertPem
			? fingerprintSha256Hex(settings.encryptionCertPem)
			: null,
		encryptionCertNotAfter: parseCertNotAfterIso(settings.encryptionCertPem),
		...encryptionCrypto,
		metadataUrl: urls.metadataUrl,
		ssoUrl: urls.ssoUrl,
		idpBaseUrl: urls.idpBaseUrl,
		rotation: {
			active: rotationActive,
			startedAt: settings.rotationStartedAt?.toISOString() ?? null,
			hasPendingCertificate: Boolean(settings.pendingSigningCertPem),
			pendingCertFingerprintSha256: settings.pendingSigningCertPem
				? fingerprintSha256Hex(settings.pendingSigningCertPem)
				: null,
			pendingSigningKeyFamily: (settings.pendingSigningKeyFamily as 'rsa' | 'ec' | null) ?? null,
			pendingSigningSignatureAlgorithmId: settings.pendingSigningSignatureAlgorithmId ?? null,
			pendingSigningRsaModulusBits: settings.pendingSigningRsaModulusBits ?? null,
			pendingSigningEcCurve:
				(settings.pendingSigningEcCurve as 'P-256' | 'P-384' | 'P-521' | null) ?? null,
			pendingSigningCertNotAfter: parseCertNotAfterIso(settings.pendingSigningCertPem),
		},
		encryptionRotation: {
			active: encryptionRotationActive,
			startedAt: settings.encryptionRotationStartedAt?.toISOString() ?? null,
			hasPendingCertificate: Boolean(settings.pendingEncryptionCertPem),
			pendingCertFingerprintSha256: settings.pendingEncryptionCertPem
				? fingerprintSha256Hex(settings.pendingEncryptionCertPem)
				: null,
			pendingEncryptionKeyFamily:
				(settings.pendingEncryptionKeyFamily as 'rsa' | 'ec' | null) ?? null,
			pendingEncryptionKeyTransportAlgorithmId:
				settings.pendingEncryptionKeyTransportAlgorithmId ?? null,
			pendingEncryptionRsaModulusBits: settings.pendingEncryptionRsaModulusBits ?? null,
			pendingEncryptionEcCurve:
				(settings.pendingEncryptionEcCurve as 'P-256' | 'P-384' | 'P-521' | null) ?? null,
			pendingEncryptionCertNotAfter: parseCertNotAfterIso(settings.pendingEncryptionCertPem),
		},
		updatedAt: settings.updatedAt.toISOString(),
	};
}
