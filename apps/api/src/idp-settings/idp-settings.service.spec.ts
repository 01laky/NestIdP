import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdpSigningCryptoValidationError } from '@nestidp/shared';
import { IdpSettingsService } from './idp-settings.service';
import { getTestSigningMaterial } from '../prisma/test-fixtures';

describe('IdpSettingsService', () => {
	let certPem: string;
	let privateKeyPem: string;
	let otherMaterial: ReturnType<typeof getTestSigningMaterial>;

	const prisma = {
		idpSettings: {
			findUnique: jest.fn(),
			update: jest.fn(),
		},
	};

	const configService = {
		get: jest.fn((key: string) => (key === 'IDP_BASE_URL' ? 'http://localhost:3000' : undefined)),
	} as unknown as ConfigService;

	const encryptionService = {
		encrypt: jest.fn((v: string) => `enc:${v}`),
	};

	const idpSigningService = {
		generateKeyPairAndCert: jest.fn(() => {
			const generated = getTestSigningMaterial('https://generated.example.com');
			return {
				certPem: generated.certPem,
				privateKeyPem: generated.privateKeyPem,
				metadata: {
					signingKeyFamily: 'rsa' as const,
					signingSignatureAlgorithmId: 'rsa-sha256',
					signingRsaModulusBits: 2048,
					signingEcCurve: null,
				},
			};
		}),
	};

	const samlMetadataService = {
		generateMetadata: jest.fn().mockResolvedValue('<md:EntityDescriptor/>'),
	};

	const audit = {
		logSettingsUpdated: jest.fn(),
		logSigningCertGenerated: jest.fn(),
		logSigningCertUploaded: jest.fn(),
		logRotationStarted: jest.fn(),
		logRotationCompleted: jest.fn(),
		logRotationCancelled: jest.fn(),
	};

	const service = new IdpSettingsService(
		prisma as never,
		configService,
		encryptionService as never,
		idpSigningService as never,
		samlMetadataService as never,
		audit as never,
	);

	let baseSettings: {
		id: string;
		entityId: string;
		nameIdFormat: string;
		signingCertPem: string;
		signingKeyEncrypted: string;
		pendingSigningCertPem: null;
		pendingSigningKeyEncrypted: null;
		rotationStartedAt: null;
		createdAt: Date;
		updatedAt: Date;
	};

	beforeAll(() => {
		const primary = getTestSigningMaterial('http://localhost:3000');
		certPem = primary.certPem;
		privateKeyPem = primary.privateKeyPem;
		otherMaterial = getTestSigningMaterial('https://other.example.com');
		baseSettings = {
			id: 'default',
			entityId: 'http://localhost:3000',
			nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			signingCertPem: certPem,
			signingKeyEncrypted: 'enc-primary',
			pendingSigningCertPem: null,
			pendingSigningKeyEncrypted: null,
			rotationStartedAt: null,
			createdAt: new Date('2026-01-01T00:00:00.000Z'),
			updatedAt: new Date('2026-01-01T00:00:00.000Z'),
		};
	});

	beforeEach(() => {
		jest.clearAllMocks();
		prisma.idpSettings.findUnique.mockResolvedValue(baseSettings);
		prisma.idpSettings.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
			Promise.resolve({
				...baseSettings,
				...data,
				updatedAt: new Date('2026-01-02T00:00:00.000Z'),
			}),
		);
	});

	it('API-IDP-SVC-01: getSettings maps public DTO', async () => {
		const result = await service.getSettings();
		expect(result.entityId).toBe('http://localhost:3000');
		expect(result.metadataUrl).toBe('http://localhost:3000/saml/metadata');
		expect(result.hasSigningCertificate).toBe(true);
	});

	it('API-IDP-SVC-02: getSettings missing row → NotFoundException', async () => {
		prisma.idpSettings.findUnique.mockResolvedValue(null);
		await expect(service.getSettings()).rejects.toThrow(NotFoundException);
	});

	it('API-IDP-SVC-03: updateSettings empty body → BadRequestException', async () => {
		await expect(service.updateSettings({})).rejects.toThrow('At least one field is required');
	});

	it('API-IDP-SVC-04: updateSettings patches entityId and audits', async () => {
		const result = await service.updateSettings({ entityId: 'https://new-idp.example.com' });
		expect(prisma.idpSettings.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: { entityId: 'https://new-idp.example.com' },
			}),
		);
		expect(audit.logSettingsUpdated).toHaveBeenCalledWith(['entityId']);
		expect(result.entityId).toBe('https://new-idp.example.com');
	});

	it('API-IDP-SVC-05: updateSettings invalid entityId → BadRequestException', async () => {
		await expect(service.updateSettings({ entityId: 'bad-scheme://x' })).rejects.toThrow(
			BadRequestException,
		);
	});

	it('API-IDP-SVC-06: generatePrimaryCert replaces signing material', async () => {
		const result = await service.generatePrimaryCert();
		expect(idpSigningService.generateKeyPairAndCert).toHaveBeenCalledWith(
			baseSettings.entityId,
			{},
		);
		expect(encryptionService.encrypt).toHaveBeenCalled();
		expect(audit.logSigningCertGenerated).toHaveBeenCalledWith(false, {
			keyFamily: 'rsa',
			signatureAlgorithmId: 'rsa-sha256',
			rsaModulusBits: 2048,
			ecCurve: undefined,
			notAfter: undefined,
		});
		expect(result.hasSigningCertificate).toBe(true);
	});

	it('API-IDP-SVC-07: generatePrimaryCert blocked during rotation → ConflictException', async () => {
		prisma.idpSettings.findUnique.mockResolvedValue({
			...baseSettings,
			pendingSigningCertPem: certPem,
		});
		await expect(service.generatePrimaryCert()).rejects.toThrow(ConflictException);
	});

	it('API-IDP-SVC-08: uploadPrimaryCert stores validated pair', async () => {
		await service.uploadPrimaryCert({
			signingCertPem: certPem,
			signingPrivateKeyPem: privateKeyPem,
		});
		expect(audit.logSigningCertUploaded).toHaveBeenCalledWith(false);
		expect(prisma.idpSettings.update).toHaveBeenCalled();
	});

	it('API-IDP-SVC-09: uploadPrimaryCert mismatched pair → BadRequestException', async () => {
		await expect(
			service.uploadPrimaryCert({
				signingCertPem: certPem,
				signingPrivateKeyPem: otherMaterial.privateKeyPem,
			}),
		).rejects.toThrow(BadRequestException);
	});

	it('API-IDP-SVC-10: startRotation generate stores pending cert', async () => {
		const result = await service.startRotation({ mode: 'generate' });
		expect(audit.logRotationStarted).toHaveBeenCalledWith('generate', {
			keyFamily: 'rsa',
			signatureAlgorithmId: 'rsa-sha256',
			rsaModulusBits: 2048,
			ecCurve: undefined,
			notAfter: undefined,
		});
		expect(result.rotation.active).toBe(true);
		expect(result.rotation.hasPendingCertificate).toBe(true);
	});

	it('API-IDP-SVC-11: startRotation without primary cert → ConflictException', async () => {
		prisma.idpSettings.findUnique.mockResolvedValue({
			...baseSettings,
			signingCertPem: null,
			signingKeyEncrypted: null,
		});
		await expect(service.startRotation({ mode: 'generate' })).rejects.toThrow(
			'Configure or generate primary',
		);
	});

	it('API-IDP-SVC-12: startRotation when already active → ConflictException', async () => {
		prisma.idpSettings.findUnique.mockResolvedValue({
			...baseSettings,
			pendingSigningCertPem: certPem,
			pendingSigningKeyEncrypted: 'enc-pending',
		});
		await expect(service.startRotation({ mode: 'generate' })).rejects.toThrow(
			'already in progress',
		);
	});

	it('API-IDP-SVC-13: completeRotation promotes pending and clears flags', async () => {
		prisma.idpSettings.findUnique.mockResolvedValue({
			...baseSettings,
			pendingSigningCertPem: otherMaterial.certPem,
			pendingSigningKeyEncrypted: 'enc-pending',
			pendingSigningKeyFamily: 'ec',
			pendingSigningSignatureAlgorithmId: 'ecdsa-sha384',
			pendingSigningRsaModulusBits: null,
			pendingSigningEcCurve: 'P-384',
		});
		await service.completeRotation();
		expect(prisma.idpSettings.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					signingCertPem: otherMaterial.certPem,
					signingKeyFamily: 'ec',
					signingSignatureAlgorithmId: 'ecdsa-sha384',
					signingEcCurve: 'P-384',
					pendingSigningKeyFamily: null,
					pendingSigningSignatureAlgorithmId: null,
					pendingSigningCertPem: null,
					rotationStartedAt: null,
				}),
			}),
		);
		expect(audit.logRotationCompleted).toHaveBeenCalled();
	});

	it('API-IDP-SVC-19: generatePrimaryCert forwards custom options to signing service', async () => {
		await service.generatePrimaryCert({
			rsaModulusBits: 3072,
			signatureAlgorithmId: 'rsa-sha384',
			notAfter: '2029-03-01',
		});
		expect(idpSigningService.generateKeyPairAndCert).toHaveBeenCalledWith(
			baseSettings.entityId,
			expect.objectContaining({
				rsaModulusBits: 3072,
				signatureAlgorithmId: 'rsa-sha384',
				notAfter: '2029-03-01',
			}),
		);
	});

	it('API-IDP-SVC-20: generatePrimaryCert maps IdpSigningCryptoValidationError to 400', async () => {
		idpSigningService.generateKeyPairAndCert.mockImplementation(() => {
			throw new IdpSigningCryptoValidationError(
				'incompatible',
				'idp_signing_key_algorithm_mismatch',
			);
		});
		await expect(
			service.generatePrimaryCert({
				keyFamily: 'ec',
				signatureAlgorithmId: 'rsa-sha256',
				notAfter: '2028-01-01',
			}),
		).rejects.toThrow(BadRequestException);
	});

	it('API-IDP-SVC-21: cancelRotation clears pending crypto columns', async () => {
		prisma.idpSettings.findUnique.mockResolvedValue({
			...baseSettings,
			pendingSigningCertPem: otherMaterial.certPem,
			pendingSigningKeyEncrypted: 'enc-pending',
			pendingSigningKeyFamily: 'rsa',
			pendingSigningSignatureAlgorithmId: 'rsa-sha512',
			pendingSigningRsaModulusBits: 2048,
		});
		await service.cancelRotation();
		expect(prisma.idpSettings.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					pendingSigningKeyFamily: null,
					pendingSigningSignatureAlgorithmId: null,
					pendingSigningRsaModulusBits: null,
					pendingSigningEcCurve: null,
				}),
			}),
		);
	});

	it('API-IDP-SVC-14: completeRotation without pending → ConflictException', async () => {
		await expect(service.completeRotation()).rejects.toThrow('No certificate rotation');
	});

	it('API-IDP-SVC-15: cancelRotation clears pending fields', async () => {
		prisma.idpSettings.findUnique.mockResolvedValue({
			...baseSettings,
			pendingSigningCertPem: otherMaterial.certPem,
			pendingSigningKeyEncrypted: 'enc-pending',
		});
		const result = await service.cancelRotation();
		expect(audit.logRotationCancelled).toHaveBeenCalled();
		expect(result.rotation.active).toBe(false);
	});

	it('API-IDP-SVC-16: getMetadataPreview returns xml payload', async () => {
		const preview = await service.getMetadataPreview();
		expect(preview.xml).toContain('EntityDescriptor');
		expect(preview.contentType).toBe('application/samlmetadata+xml');
	});

	it('API-IDP-SVC-17: getMetadataUrlResponse delegates entityId', async () => {
		const urls = await service.getMetadataUrlResponse();
		expect(urls.entityId).toBe('http://localhost:3000');
		expect(urls.ssoUrl).toBe('http://localhost:3000/saml/sso');
	});

	it('API-IDP-SVC-18: buildDashboardIdpStatus reports ok cert', async () => {
		const status = await service.buildDashboardIdpStatus();
		expect(status.certStatus).toBe('ok');
		expect(status.hasSigningCertificate).toBe(true);
	});
});
