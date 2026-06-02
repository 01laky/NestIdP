import type { IdpSettings } from '@prisma/client';
import type {
	AdminDashboardIdpCertStatus,
	AdminDashboardIdpStatusDto,
	IdpMetadataUrlResponseDto,
	IdpSettingsPublicDto,
} from '@nestidp/shared';
import {
	IDP_CERT_EXPIRY_WARNING_DAYS,
	IDP_SETTINGS_ROUTE_PREFIX,
	SAML_METADATA_PATH,
	SAML_SSO_PATH,
} from '@nestidp/shared';
import { fingerprintSha256Hex, isCertExpiringSoon, parseCertNotAfterIso } from './idp-cert.util';

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

export function toDashboardIdpStatus(settings: IdpSettings): AdminDashboardIdpStatusDto {
	const rotationActive = Boolean(
		settings.pendingSigningCertPem || settings.pendingSigningKeyEncrypted,
	);
	return {
		idpSettingsRoute: IDP_SETTINGS_ROUTE_PREFIX,
		hasSigningCertificate: Boolean(settings.signingCertPem && settings.signingKeyEncrypted),
		rotationActive,
		signingCertNotAfter: parseCertNotAfterIso(settings.signingCertPem),
		certStatus: deriveCertStatus(settings),
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
	return {
		entityId: settings.entityId,
		nameIdFormat: settings.nameIdFormat,
		hasSigningCertificate: Boolean(settings.signingCertPem && settings.signingKeyEncrypted),
		signingCertFingerprintSha256: settings.signingCertPem
			? fingerprintSha256Hex(settings.signingCertPem)
			: null,
		signingCertNotAfter: parseCertNotAfterIso(settings.signingCertPem),
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
		},
		updatedAt: settings.updatedAt.toISOString(),
	};
}
