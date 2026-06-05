/** Admin REST — global IdP settings (v0.9.0). */
import type { IdpCertEcCurve, IdpCertKeyFamily } from './idp-cert-common.js';
import type { GenerateIdpEncryptionCertRequestDto } from './idp-encryption-crypto.js';
import type { GenerateIdpSigningCertRequestDto } from './idp-signing-crypto.js';

export const IDP_SETTINGS_API_PATH = '/api/admin/idp/settings';

/** Admin SPA — settings section. */
export const SETTINGS_ROUTE_PREFIX = '/admin/settings';

/** Admin SPA — IdP settings page. */
export const IDP_SETTINGS_ROUTE_PREFIX = '/admin/settings/idp';

/** Warn operators when primary cert expires within this many days. */
export const IDP_CERT_EXPIRY_WARNING_DAYS = 30;

/** Warn when rotation has been pending longer than this many days. */
export const IDP_ROTATION_STALE_WARNING_DAYS = 7;

export type AdminDashboardIdpCertStatus = 'missing' | 'ok' | 'expiring_soon' | 'rotation_active';

export type AdminDashboardEncryptionCertStatus = 'not_configured' | AdminDashboardIdpCertStatus;

export interface IdpEncryptionRotationStatusDto {
	active: boolean;
	startedAt: string | null;
	hasPendingCertificate: boolean;
	pendingCertFingerprintSha256: string | null;
	pendingEncryptionKeyFamily: IdpCertKeyFamily | null;
	pendingEncryptionKeyTransportAlgorithmId: string | null;
	pendingEncryptionRsaModulusBits: number | null;
	pendingEncryptionEcCurve: IdpCertEcCurve | null;
	pendingEncryptionCertNotAfter: string | null;
}

export interface IdpSigningRotationStatusDto {
	active: boolean;
	startedAt: string | null;
	hasPendingCertificate: boolean;
	pendingCertFingerprintSha256: string | null;
	pendingSigningKeyFamily: IdpCertKeyFamily | null;
	pendingSigningSignatureAlgorithmId: string | null;
	pendingSigningRsaModulusBits: number | null;
	pendingSigningEcCurve: IdpCertEcCurve | null;
	pendingSigningCertNotAfter: string | null;
}

export interface IdpSettingsPublicDto {
	entityId: string;
	nameIdFormat: string;
	wantAuthnRequestsSigned: boolean;
	hasSigningCertificate: boolean;
	signingCertFingerprintSha256: string | null;
	signingCertNotAfter: string | null;
	signingKeyFamily: IdpCertKeyFamily | null;
	signingSignatureAlgorithmId: string | null;
	signingRsaModulusBits: number | null;
	signingEcCurve: IdpCertEcCurve | null;
	metadataUrl: string;
	ssoUrl: string;
	idpBaseUrl: string;
	rotation: IdpSigningRotationStatusDto;
	hasEncryptionCertificate: boolean;
	encryptionCertFingerprintSha256: string | null;
	encryptionCertNotAfter: string | null;
	encryptionKeyFamily: IdpCertKeyFamily | null;
	encryptionKeyTransportAlgorithmId: string | null;
	encryptionRsaModulusBits: number | null;
	encryptionEcCurve: IdpCertEcCurve | null;
	encryptionRotation: IdpEncryptionRotationStatusDto;
	updatedAt: string;
}

export interface UpdateIdpSettingsRequestDto {
	entityId?: string;
	nameIdFormat?: string;
	wantAuthnRequestsSigned?: boolean;
}

export interface UploadIdpSigningCertRequestDto {
	signingCertPem: string;
	signingPrivateKeyPem: string;
}

export interface UploadIdpEncryptionCertRequestDto {
	encryptionCertPem: string;
	encryptionPrivateKeyPem: string;
}

export type { GenerateIdpSigningCertRequestDto, GenerateIdpEncryptionCertRequestDto };

export type StartIdpCertRotationRequestDto =
	| ({ mode: 'generate' } & GenerateIdpSigningCertRequestDto)
	| { mode: 'upload'; signingCertPem: string; signingPrivateKeyPem: string };

export type StartIdpEncryptionCertRotationRequestDto =
	| ({ mode: 'generate' } & GenerateIdpEncryptionCertRequestDto)
	| { mode: 'upload'; encryptionCertPem: string; encryptionPrivateKeyPem: string };

export interface IdpMetadataPreviewResponseDto {
	xml: string;
	contentType: string;
}
