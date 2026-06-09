import { describe, expect, it } from 'vitest';
import {
	IDP_CERT_EXPIRY_WARNING_DAYS,
	IDP_ROTATION_STALE_WARNING_DAYS,
	IDP_SETTINGS_API_PATH,
	IDP_SETTINGS_ROUTE_PREFIX,
	SETTINGS_ROUTE_PREFIX,
	type IdpMetadataPreviewResponseDto,
	type IdpSettingsPublicDto,
	type StartIdpCertRotationRequestDto,
	type UpdateIdpSettingsRequestDto,
} from '@shared/idp-settings.js';
import {
	IDP_SETTINGS_API_PATH as INDEX_API_PATH,
	IDP_SETTINGS_ROUTE_PREFIX as INDEX_ROUTE,
	SETTINGS_ROUTE_PREFIX as INDEX_SETTINGS,
} from '@shared/index.js';

describe('idp-settings shared', () => {
	it('SH-IDP-01: IDP_SETTINGS_API_PATH is /api/admin/idp/settings', () => {
		expect(IDP_SETTINGS_API_PATH).toBe('/api/admin/idp/settings');
	});

	it('SH-IDP-02: IDP_SETTINGS_ROUTE_PREFIX is /admin/settings/idp', () => {
		expect(IDP_SETTINGS_ROUTE_PREFIX).toBe('/admin/settings/idp');
	});

	it('SH-IDP-03: SETTINGS_ROUTE_PREFIX is /admin/settings', () => {
		expect(SETTINGS_ROUTE_PREFIX).toBe('/admin/settings');
	});

	it('SH-IDP-04: UI route prefix ≠ API path', () => {
		expect(IDP_SETTINGS_ROUTE_PREFIX).not.toBe(IDP_SETTINGS_API_PATH);
	});

	it('SH-IDP-05: IdpSettingsPublicDto assignability with full shape', () => {
		const dto: IdpSettingsPublicDto = {
			entityId: 'https://idp.example.com',
			nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			wantAuthnRequestsSigned: true,
			hasSigningCertificate: true,
			signingCertFingerprintSha256: 'abc123',
			signingCertNotAfter: '2030-01-01T00:00:00.000Z',
			signingKeyFamily: 'rsa',
			signingSignatureAlgorithmId: 'rsa-sha256',
			signingRsaModulusBits: 2048,
			signingEcCurve: null,
			metadataUrl: 'https://idp.example.com/saml/metadata',
			ssoUrl: 'https://idp.example.com/saml/sso',
			idpBaseUrl: 'https://idp.example.com',
			rotation: {
				active: false,
				startedAt: null,
				hasPendingCertificate: false,
				pendingCertFingerprintSha256: null,
				pendingSigningKeyFamily: null,
				pendingSigningSignatureAlgorithmId: null,
				pendingSigningRsaModulusBits: null,
				pendingSigningEcCurve: null,
				pendingSigningCertNotAfter: null,
				auto: {
					enabled: false,
					disabledAt: null,
					consecutiveFailures: 0,
					lastError: null,
					willAutoStartBy: null,
					willAutoCompleteAt: null,
				},
			},
			hasEncryptionCertificate: false,
			encryptionCertFingerprintSha256: null,
			encryptionCertNotAfter: null,
			encryptionKeyFamily: null,
			encryptionKeyTransportAlgorithmId: null,
			encryptionRsaModulusBits: null,
			encryptionEcCurve: null,
			encryptionRotation: {
				active: false,
				startedAt: null,
				hasPendingCertificate: false,
				pendingCertFingerprintSha256: null,
				pendingEncryptionKeyFamily: null,
				pendingEncryptionKeyTransportAlgorithmId: null,
				pendingEncryptionRsaModulusBits: null,
				pendingEncryptionEcCurve: null,
				pendingEncryptionCertNotAfter: null,
				auto: {
					enabled: false,
					disabledAt: null,
					consecutiveFailures: 0,
					lastError: null,
					willAutoStartBy: null,
					willAutoCompleteAt: null,
				},
			},
			lastAutoRotationCheckAt: null,
			lastAutoRotationActionAt: null,
			updatedAt: '2026-01-01T00:00:00.000Z',
		};
		expect(dto.hasSigningCertificate).toBe(true);
	});

	it('SH-IDP-06: rotation.active false nested object valid', () => {
		const rotation: IdpSettingsPublicDto['rotation'] = {
			active: false,
			startedAt: null,
			hasPendingCertificate: false,
			pendingCertFingerprintSha256: null,
			pendingSigningKeyFamily: null,
			pendingSigningSignatureAlgorithmId: null,
			pendingSigningRsaModulusBits: null,
			pendingSigningEcCurve: null,
			pendingSigningCertNotAfter: null,
			auto: {
				enabled: false,
				disabledAt: null,
				consecutiveFailures: 0,
				lastError: null,
				willAutoStartBy: null,
				willAutoCompleteAt: null,
			},
		};
		expect(rotation.active).toBe(false);
	});

	it('SH-IDP-07: rotation.active true with pending fingerprint', () => {
		const rotation: IdpSettingsPublicDto['rotation'] = {
			active: true,
			startedAt: '2026-01-01T00:00:00.000Z',
			hasPendingCertificate: true,
			pendingCertFingerprintSha256: 'pending-fp',
			pendingSigningKeyFamily: 'rsa',
			pendingSigningSignatureAlgorithmId: 'rsa-sha384',
			pendingSigningRsaModulusBits: 3072,
			pendingSigningEcCurve: null,
			pendingSigningCertNotAfter: '2031-01-01T00:00:00.000Z',
			auto: {
				enabled: true,
				disabledAt: null,
				consecutiveFailures: 0,
				lastError: null,
				willAutoStartBy: '2030-11-01T00:00:00.000Z',
				willAutoCompleteAt: '2026-01-08T00:00:00.000Z',
			},
		};
		expect(rotation.pendingCertFingerprintSha256).toBe('pending-fp');
	});

	it('SH-IDP-08: UpdateIdpSettingsRequestDto partial fields', () => {
		const body: UpdateIdpSettingsRequestDto = { entityId: 'https://new.example.com' };
		expect(body.nameIdFormat).toBeUndefined();
		expect(body.wantAuthnRequestsSigned).toBeUndefined();
	});

	it('SH-IDP-09: StartIdpCertRotationRequestDto generate mode', () => {
		const body: StartIdpCertRotationRequestDto = { mode: 'generate' };
		expect(body.mode).toBe('generate');
	});

	it('SH-IDP-10: StartIdpCertRotationRequestDto upload mode', () => {
		const body: StartIdpCertRotationRequestDto = {
			mode: 'upload',
			signingCertPem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
			signingPrivateKeyPem: '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----',
		};
		expect(body.mode).toBe('upload');
	});

	it('SH-IDP-11: IdpMetadataPreviewResponseDto contentType + xml', () => {
		const preview: IdpMetadataPreviewResponseDto = {
			xml: '<md:EntityDescriptor/>',
			contentType: 'application/samlmetadata+xml',
		};
		expect(preview.contentType).toContain('xml');
	});

	it('SH-IDP-12: constants exported from package index', () => {
		expect(INDEX_API_PATH).toBe('/api/admin/idp/settings');
		expect(INDEX_ROUTE).toBe('/admin/settings/idp');
		expect(INDEX_SETTINGS).toBe('/admin/settings');
	});

	it('SH-IDP-13: warning day constants are positive integers', () => {
		expect(IDP_CERT_EXPIRY_WARNING_DAYS).toBeGreaterThan(0);
		expect(IDP_ROTATION_STALE_WARNING_DAYS).toBeGreaterThan(0);
	});
});
