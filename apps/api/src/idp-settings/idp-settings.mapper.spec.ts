import type { IdpSettings } from '@prisma/client';
import { IDP_SETTINGS_ROUTE_PREFIX } from '@nestidp/shared';
import {
	buildIdpUrls,
	buildMetadataUrlResponse,
	deriveCertStatus,
	deriveEncryptionCertStatus,
	resolveIdpBaseUrl,
	toDashboardIdpStatus,
	toIdpSettingsPublicDto,
} from './idp-settings.mapper';
import { generateTestRsaEncryptionCert } from './idp-encryption-cert.util';
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
			signingKeyFamily: 'rsa',
			signingSignatureAlgorithmId: 'rsa-sha256',
			signingRsaModulusBits: 2048,
			signingEcCurve: null,
			pendingSigningCertPem: null,
			pendingSigningKeyEncrypted: null,
			pendingSigningKeyFamily: null,
			pendingSigningSignatureAlgorithmId: null,
			pendingSigningRsaModulusBits: null,
			pendingSigningEcCurve: null,
			rotationStartedAt: null,
			encryptionCertPem: null,
			encryptionKeyEncrypted: null,
			encryptionKeyFamily: null,
			encryptionRsaModulusBits: null,
			pendingEncryptionCertPem: null,
			pendingEncryptionKeyEncrypted: null,
			pendingEncryptionKeyFamily: null,
			pendingEncryptionRsaModulusBits: null,
			encryptionRotationStartedAt: null,
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

	it('API-IDP-MAP-16: rotation DTO maps pending signing crypto and expiry', () => {
		const pending = getTestSigningMaterial('https://pending.example.com');
		const dto = toIdpSettingsPublicDto(
			settingsRow({
				pendingSigningCertPem: pending.certPem,
				pendingSigningKeyEncrypted: 'pending-enc',
				pendingSigningKeyFamily: 'ec',
				pendingSigningSignatureAlgorithmId: 'ecdsa-sha384',
				pendingSigningRsaModulusBits: null,
				pendingSigningEcCurve: 'P-384',
				rotationStartedAt: new Date('2026-04-01T00:00:00.000Z'),
			}),
			'http://localhost:3000',
		);
		expect(dto.rotation.pendingSigningKeyFamily).toBe('ec');
		expect(dto.rotation.pendingSigningSignatureAlgorithmId).toBe('ecdsa-sha384');
		expect(dto.rotation.pendingSigningEcCurve).toBe('P-384');
		expect(dto.rotation.pendingSigningCertNotAfter).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('API-IDP-MAP-17: dashboard maps primary signing crypto fields', () => {
		const dto = toDashboardIdpStatus(
			settingsRow({
				signingKeyFamily: 'rsa',
				signingSignatureAlgorithmId: 'rsa-sha512',
				signingRsaModulusBits: 3072,
			}),
		);
		expect(dto.signingSignatureAlgorithmId).toBe('rsa-sha512');
		expect(dto.signingRsaModulusBits).toBe(3072);
	});

	it('API-IDP-MAP-18: public DTO maps encryptionRotation and primary encryption crypto', () => {
		const enc = generateTestRsaEncryptionCert('https://enc-map.example.com');
		const dto = toIdpSettingsPublicDto(
			settingsRow({
				encryptionCertPem: enc.certPem,
				encryptionKeyEncrypted: 'enc-blob',
				encryptionKeyFamily: 'rsa',
				encryptionKeyTransportAlgorithmId: 'rsa-oaep',
				encryptionRsaModulusBits: 3072,
				encryptionEcCurve: null,
				pendingEncryptionCertPem: enc.certPem,
				pendingEncryptionKeyEncrypted: 'pending-enc',
				pendingEncryptionKeyFamily: 'rsa',
				pendingEncryptionKeyTransportAlgorithmId: 'rsa-1_5',
				pendingEncryptionRsaModulusBits: 4096,
				encryptionRotationStartedAt: new Date('2026-05-01T00:00:00.000Z'),
			}),
			'http://localhost:3000',
		);
		expect(dto.hasEncryptionCertificate).toBe(true);
		expect(dto.encryptionKeyTransportAlgorithmId).toBe('rsa-oaep');
		expect(dto.encryptionRsaModulusBits).toBe(3072);
		expect(dto.encryptionRotation.active).toBe(true);
		expect(dto.encryptionRotation.pendingEncryptionKeyTransportAlgorithmId).toBe('rsa-1_5');
		expect(dto.encryptionRotation.pendingEncryptionRsaModulusBits).toBe(4096);
		expect(JSON.stringify(dto)).not.toContain('BEGIN PRIVATE KEY');
		expect(dto).not.toHaveProperty('encryptionKeyEncrypted');
	});

	it('API-IDP-MAP-19: deriveEncryptionCertStatus not_configured / ok / rotation_active', () => {
		expect(deriveEncryptionCertStatus(settingsRow())).toBe('not_configured');
		const enc = generateTestRsaEncryptionCert('https://enc-status.example.com', 365);
		expect(
			deriveEncryptionCertStatus(
				settingsRow({
					encryptionCertPem: enc.certPem,
					encryptionKeyEncrypted: 'enc',
				}),
			),
		).toBe('ok');
		expect(
			deriveEncryptionCertStatus(
				settingsRow({
					encryptionCertPem: enc.certPem,
					encryptionKeyEncrypted: 'enc',
					pendingEncryptionCertPem: enc.certPem,
					pendingEncryptionKeyEncrypted: 'pending',
				}),
			),
		).toBe('rotation_active');
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
