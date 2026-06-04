import { AuditPersistenceService } from '../audit/audit-persistence.service';
import { IdpSettingsAuditService } from './idp-settings-audit.service';

describe('IdpSettingsAuditService', () => {
	let service: IdpSettingsAuditService;
	let logSpy: jest.SpyInstance;
	const audit = { recordSafe: jest.fn() };

	beforeEach(() => {
		jest.clearAllMocks();
		service = new IdpSettingsAuditService(audit as unknown as AuditPersistenceService);
		logSpy = jest.spyOn(service['logger'], 'log').mockImplementation();
	});

	afterEach(() => {
		logSpy.mockRestore();
	});

	it('API-IDP-AUDIT-01: logSettingsUpdated emits fields array', () => {
		service.logSettingsUpdated(['entityId', 'nameIdFormat']);
		expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual({
			event: 'idp_settings_updated',
			fields: ['entityId', 'nameIdFormat'],
		});
	});

	it('API-IDP-AUDIT-02: logSigningCertGenerated primary', () => {
		service.logSigningCertGenerated(false);
		expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toMatchObject({
			event: 'idp_signing_cert_generated',
			rotation: false,
		});
	});

	it('API-IDP-AUDIT-03: logSigningCertUploaded primary', () => {
		service.logSigningCertUploaded(false);
		expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toMatchObject({
			event: 'idp_signing_cert_uploaded',
			rotation: false,
		});
	});

	it('API-IDP-AUDIT-04: logRotationStarted generate mode', () => {
		service.logRotationStarted('generate');
		expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual({
			event: 'idp_signing_rotation_started',
			mode: 'generate',
		});
	});

	it('API-IDP-AUDIT-05: logRotationStarted upload mode', () => {
		service.logRotationStarted('upload');
		expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toMatchObject({
			event: 'idp_signing_rotation_started',
			mode: 'upload',
		});
	});

	it('API-IDP-AUDIT-06: logRotationCompleted', () => {
		service.logRotationCompleted();
		expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual({
			event: 'idp_signing_rotation_completed',
		});
	});

	it('API-IDP-AUDIT-07: logRotationCancelled', () => {
		service.logRotationCancelled();
		expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual({
			event: 'idp_signing_rotation_cancelled',
		});
	});

	it('API-IDP-AUDIT-09: logSigningCertGenerated includes crypto metadata without PEM', () => {
		service.logSigningCertGenerated(false, {
			keyFamily: 'rsa',
			signatureAlgorithmId: 'rsa-sha256',
			rsaModulusBits: 2048,
			notAfter: '2028-06-01',
		});
		expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toMatchObject({
			event: 'idp_signing_cert_generated',
			keyFamily: 'rsa',
			signatureAlgorithmId: 'rsa-sha256',
			rsaModulusBits: 2048,
			notAfter: '2028-06-01',
		});
	});

	it('API-IDP-AUDIT-10: logRotationStarted generate includes crypto metadata', () => {
		service.logRotationStarted('generate', {
			keyFamily: 'ec',
			signatureAlgorithmId: 'ecdsa-sha256',
			ecCurve: 'P-256',
			notAfter: '2029-01-01',
		});
		expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual({
			event: 'idp_signing_rotation_started',
			mode: 'generate',
			keyFamily: 'ec',
			signatureAlgorithmId: 'ecdsa-sha256',
			ecCurve: 'P-256',
			notAfter: '2029-01-01',
		});
	});

	it('API-IDP-AUDIT-08: no audit payload contains PEM markers', () => {
		const samplePem = '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----';
		service.logSettingsUpdated(['entityId']);
		service.logSigningCertGenerated(false);
		service.logSigningCertUploaded(false);
		service.logRotationStarted('generate');
		service.logRotationCompleted();
		service.logRotationCancelled();
		for (const call of logSpy.mock.calls) {
			const serialized = String(call[0]);
			expect(serialized).not.toContain('BEGIN CERTIFICATE');
			expect(serialized).not.toContain('BEGIN PRIVATE KEY');
			expect(serialized).not.toContain(samplePem);
		}
	});
});
