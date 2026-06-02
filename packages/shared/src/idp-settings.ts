/** Admin REST — global IdP settings (v0.9.0). */
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

export interface IdpSigningRotationStatusDto {
	active: boolean;
	startedAt: string | null;
	hasPendingCertificate: boolean;
	pendingCertFingerprintSha256: string | null;
}

export interface IdpSettingsPublicDto {
	entityId: string;
	nameIdFormat: string;
	hasSigningCertificate: boolean;
	signingCertFingerprintSha256: string | null;
	signingCertNotAfter: string | null;
	metadataUrl: string;
	ssoUrl: string;
	idpBaseUrl: string;
	rotation: IdpSigningRotationStatusDto;
	updatedAt: string;
}

export interface UpdateIdpSettingsRequestDto {
	entityId?: string;
	nameIdFormat?: string;
}

export interface UploadIdpSigningCertRequestDto {
	signingCertPem: string;
	signingPrivateKeyPem: string;
}

export type StartIdpCertRotationRequestDto =
	| { mode: 'generate' }
	| { mode: 'upload'; signingCertPem: string; signingPrivateKeyPem: string };

export interface IdpMetadataPreviewResponseDto {
	xml: string;
	contentType: string;
}
