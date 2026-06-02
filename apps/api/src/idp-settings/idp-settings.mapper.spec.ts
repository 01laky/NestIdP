import type { IdpSettings } from '@prisma/client';
import { IDP_SETTINGS_ROUTE_PREFIX } from '@nestidp/shared';
import {
	buildIdpUrls,
	buildMetadataUrlResponse,
	deriveCertStatus,
	resolveIdpBaseUrl,
	toDashboardIdpStatus,
	toIdpSettingsPublicDto,
} from './idp-settings.mapper';
import { getTestSigningMaterial, getTestSigningMaterialWithDays } from '../prisma/test-fixtures';

describe('idp-settings.mapper', () => {
	const baseUrl = 'http://localhost:3000/';
	const { certPem } = getTestSigningMaterial('http://localhost:3000');

	const settingsRow = (overrides: Partial<IdpSettings> = {}): IdpSettings =>
		({
			id: 'default',
			entityId: 'http://localhost:3000',
			nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			signingCertPem: certPem,
			signingKeyEncrypted: 'enc-key',
			pendingSigningCertPem: null,
			pendingSigningKeyEncrypted: null,
			rotationStartedAt: null,
			createdAt: new Date('2026-01-01T00:00:00.000Z'),
			updatedAt: new Date('2026-01-02T00:00:00.000Z'),
			...overrides,
		}) as IdpSettings;

	it('API-IDP-MAP-01: resolveIdpBaseUrl strips trailing slashes', () => {
		expect(resolveIdpBaseUrl('https://idp.example.com///')).toBe('https://idp.example.com');
	});

	it('API-IDP-MAP-02: buildIdpUrls returns metadata and SSO paths', () => {
		const urls = buildIdpUrls(baseUrl);
		expect(urls.metadataUrl).toBe('http://localhost:3000/saml/metadata');
		expect(urls.ssoUrl).toBe('http://localhost:3000/saml/sso');
		expect(urls.idpBaseUrl).toBe('http://localhost:3000');
	});

	it('API-IDP-MAP-03: buildMetadataUrlResponse includes entityId', () => {
		const dto = buildMetadataUrlResponse(settingsRow(), 'http://localhost:3000');
		expect(dto.entityId).toBe('http://localhost:3000');
		expect(dto.metadataUrl).toContain('/saml/metadata');
	});

	it('API-IDP-MAP-04: deriveCertStatus missing without cert', () => {
		expect(deriveCertStatus(settingsRow({ signingCertPem: null, signingKeyEncrypted: null }))).toBe(
			'missing',
		);
	});

	it('API-IDP-MAP-05: deriveCertStatus ok with valid cert', () => {
		expect(deriveCertStatus(settingsRow())).toBe('ok');
	});

	it('API-IDP-MAP-06: deriveCertStatus rotation_active when pending cert', () => {
		expect(
			deriveCertStatus(
				settingsRow({
					pendingSigningCertPem: certPem,
					pendingSigningKeyEncrypted: 'pending-enc',
				}),
			),
		).toBe('rotation_active');
	});

	it('API-IDP-MAP-07: toIdpSettingsPublicDto never exposes private key fields', () => {
		const dto = toIdpSettingsPublicDto(settingsRow(), 'http://localhost:3000');
		expect(dto).not.toHaveProperty('signingKeyEncrypted');
		expect(dto).not.toHaveProperty('signingPrivateKeyPem');
		expect(dto.hasSigningCertificate).toBe(true);
	});

	it('API-IDP-MAP-08: toIdpSettingsPublicDto includes fingerprint when cert present', () => {
		const dto = toIdpSettingsPublicDto(settingsRow(), 'http://localhost:3000');
		expect(dto.signingCertFingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(dto.signingCertNotAfter).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('API-IDP-MAP-09: toIdpSettingsPublicDto rotation inactive by default', () => {
		const dto = toIdpSettingsPublicDto(settingsRow(), 'http://localhost:3000');
		expect(dto.rotation.active).toBe(false);
		expect(dto.rotation.hasPendingCertificate).toBe(false);
	});

	it('API-IDP-MAP-10: toIdpSettingsPublicDto rotation active with pending cert', () => {
		const started = new Date('2026-03-01T12:00:00.000Z');
		const dto = toIdpSettingsPublicDto(
			settingsRow({
				pendingSigningCertPem: certPem,
				pendingSigningKeyEncrypted: 'pending',
				rotationStartedAt: started,
			}),
			'http://localhost:3000',
		);
		expect(dto.rotation.active).toBe(true);
		expect(dto.rotation.startedAt).toBe(started.toISOString());
		expect(dto.rotation.pendingCertFingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
	});

	it('API-IDP-MAP-11: toDashboardIdpStatus exposes route and cert flags', () => {
		const dto = toDashboardIdpStatus(settingsRow());
		expect(dto.idpSettingsRoute).toBe(IDP_SETTINGS_ROUTE_PREFIX);
		expect(dto.hasSigningCertificate).toBe(true);
		expect(dto.rotationActive).toBe(false);
		expect(dto.certStatus).toBe('ok');
	});

	it('API-IDP-MAP-12: toDashboardIdpStatus rotationActive when pending', () => {
		const dto = toDashboardIdpStatus(
			settingsRow({ pendingSigningCertPem: certPem, pendingSigningKeyEncrypted: 'x' }),
		);
		expect(dto.rotationActive).toBe(true);
		expect(dto.certStatus).toBe('rotation_active');
	});

	it('API-IDP-MAP-13: public mapper output omits key material', () => {
		const dto = toIdpSettingsPublicDto(
			settingsRow({ signingKeyEncrypted: 'encrypted-blob-not-pem' }),
			'http://localhost:3000',
		);
		expect(JSON.stringify(dto)).not.toContain('BEGIN PRIVATE KEY');
		expect(JSON.stringify(dto)).not.toContain('encrypted-blob');
	});

	it('API-IDP-MAP-14: deriveCertStatus expiring_soon within warning window', () => {
		const { certPem } = getTestSigningMaterialWithDays('http://localhost:3000', 15);
		expect(
			deriveCertStatus(settingsRow({ signingCertPem: certPem, signingKeyEncrypted: 'enc' })),
		).toBe('expiring_soon');
	});

	it('API-IDP-MAP-15: rotation_active takes precedence over expiring_soon', () => {
		const { certPem } = getTestSigningMaterialWithDays('http://localhost:3000', 15);
		expect(
			deriveCertStatus(
				settingsRow({
					signingCertPem: certPem,
					signingKeyEncrypted: 'enc',
					pendingSigningCertPem: certPem,
					pendingSigningKeyEncrypted: 'pending',
				}),
			),
		).toBe('rotation_active');
	});
});
