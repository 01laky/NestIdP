import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
	GenerateIdpEncryptionCertRequestDto,
	GenerateIdpSigningCertRequestDto,
	IdpMetadataPreviewResponseDto,
	IdpMetadataUrlResponseDto,
	IdpSettingsPublicDto,
	StartIdpCertRotationRequestDto,
	StartIdpEncryptionCertRotationRequestDto,
	UpdateIdpSettingsRequestDto,
	UploadIdpEncryptionCertRequestDto,
	UploadIdpSigningCertRequestDto,
} from '@nestidp/shared';
import type { AdminDashboardIdpStatusDto } from '@nestidp/shared';
import {
	IdpEncryptionCryptoValidationError,
	IdpSigningCryptoValidationError,
	type StoredEncryptionCrypto,
} from '@nestidp/shared';
import type { IdpSettings } from '@prisma/client';
import { EncryptionService } from '../../encryption/services/encryption.service';
import { PrismaService } from '../../prisma/services/prisma.service';
import { IdpEncryptionService } from '../../saml/services/idp-encryption.service';
import { IdpSigningService } from '../../saml/services/idp-signing.service';
import { SamlMetadataService } from '../../saml/services/saml-metadata.service';
import {
	IdpCertValidationError,
	prismaCryptoPendingData,
	prismaCryptoPrimaryData,
	validateSigningCertPair,
} from '../utils/idp-cert.util';
import {
	prismaEncryptionPendingData,
	prismaEncryptionPrimaryData,
	validateEncryptionKeyPair,
} from '../utils/idp-encryption-cert.util';
import {
	assertValidIdpEntityId,
	assertValidIdpNameIdFormat,
	IdpEntityIdValidationError,
	IdpNameIdFormatValidationError,
} from '../validators/idp-entity-id.validator';
import { IdpSettingsAuditService } from './idp-settings-audit.service';
import {
	buildMetadataUrlResponse,
	toDashboardIdpStatus,
	toIdpSettingsPublicDto,
} from '../mappers/idp-settings.mapper';

export interface SigningCertGeneratedAuditMeta {
	keyFamily: string;
	signatureAlgorithmId: string;
	rsaModulusBits?: number;
	ecCurve?: string;
	notAfter?: string;
}

export interface EncryptionCertGeneratedAuditMeta {
	keyFamily?: string;
	keyTransportAlgorithmId?: string;
	rsaModulusBits?: number;
	ecCurve?: string;
	notAfter?: string;
}

@Injectable()
export class IdpSettingsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
		private readonly encryptionService: EncryptionService,
		private readonly idpSigningService: IdpSigningService,
		private readonly idpEncryptionService: IdpEncryptionService,
		private readonly samlMetadataService: SamlMetadataService,
		private readonly audit: IdpSettingsAuditService,
	) {}

	async hasEncryptionCertificate(): Promise<boolean> {
		const settings = await this.findSettingsOrThrow();
		return Boolean(settings.encryptionCertPem && settings.encryptionKeyEncrypted);
	}

	async getSettings(): Promise<IdpSettingsPublicDto> {
		const settings = await this.findSettingsOrThrow();
		return toIdpSettingsPublicDto(settings, this.getIdpBaseUrl());
	}

	async updateSettings(body: UpdateIdpSettingsRequestDto): Promise<IdpSettingsPublicDto> {
		if (
			body.entityId === undefined &&
			body.nameIdFormat === undefined &&
			body.wantAuthnRequestsSigned === undefined
		) {
			throw new BadRequestException('At least one field is required');
		}

		const data: Partial<Pick<IdpSettings, 'entityId' | 'nameIdFormat' | 'wantAuthnRequestsSigned'>> =
			{};
		const updatedFields: string[] = [];

		if (body.entityId !== undefined) {
			try {
				data.entityId = assertValidIdpEntityId(body.entityId);
			} catch (error) {
				if (error instanceof IdpEntityIdValidationError) {
					throw new BadRequestException(error.message);
				}
				throw error;
			}
			updatedFields.push('entityId');
		}

		if (body.nameIdFormat !== undefined) {
			try {
				data.nameIdFormat = assertValidIdpNameIdFormat(body.nameIdFormat);
			} catch (error) {
				if (error instanceof IdpNameIdFormatValidationError) {
					throw new BadRequestException(error.message);
				}
				throw error;
			}
			updatedFields.push('nameIdFormat');
		}

		if (body.wantAuthnRequestsSigned !== undefined) {
			data.wantAuthnRequestsSigned = body.wantAuthnRequestsSigned;
			updatedFields.push('wantAuthnRequestsSigned');
		}

		const updated = await this.prisma.idpSettings.update({
			where: { id: 'default' },
			data,
		});
		this.audit.logSettingsUpdated(updatedFields);
		return toIdpSettingsPublicDto(updated, this.getIdpBaseUrl());
	}

	async generatePrimaryCert(
		body: GenerateIdpSigningCertRequestDto = {},
	): Promise<IdpSettingsPublicDto> {
		const settings = await this.findSettingsOrThrow();
		this.assertNoActiveRotation(settings);

		const generated = this.generateWithOptions(settings.entityId, body);
		const updated = await this.prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				signingCertPem: generated.certPem,
				signingKeyEncrypted: this.encryptionService.encrypt(generated.privateKeyPem),
				...prismaCryptoPrimaryData(generated.metadata),
			},
		});
		this.audit.logSigningCertGenerated(
			false,
			this.auditMetaFromGenerated(body, generated.metadata),
		);
		return toIdpSettingsPublicDto(updated, this.getIdpBaseUrl());
	}

	async uploadPrimaryCert(body: UploadIdpSigningCertRequestDto): Promise<IdpSettingsPublicDto> {
		const settings = await this.findSettingsOrThrow();
		this.assertNoActiveRotation(settings);

		const pair = this.validateCertPair(body.signingCertPem, body.signingPrivateKeyPem);
		const updated = await this.prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				signingCertPem: pair.certPem,
				signingKeyEncrypted: this.encryptionService.encrypt(pair.privateKeyPem),
				...prismaCryptoPrimaryData(pair.crypto),
			},
		});
		this.audit.logSigningCertUploaded(false);
		return toIdpSettingsPublicDto(updated, this.getIdpBaseUrl());
	}

	async startRotation(body: StartIdpCertRotationRequestDto): Promise<IdpSettingsPublicDto> {
		const settings = await this.findSettingsOrThrow();
		if (!settings.signingCertPem || !settings.signingKeyEncrypted) {
			throw new ConflictException('Configure or generate primary signing certificate first');
		}
		if (settings.pendingSigningCertPem || settings.pendingSigningKeyEncrypted) {
			throw new ConflictException('Certificate rotation already in progress');
		}

		let pendingCertPem: string;
		let pendingKeyPem: string;
		let pendingCrypto;

		if (body.mode === 'generate') {
			const { mode, ...generateOptions } = body;
			void mode;
			const generated = this.generateWithOptions(settings.entityId, generateOptions);
			pendingCertPem = generated.certPem;
			pendingKeyPem = generated.privateKeyPem;
			pendingCrypto = generated.metadata;
			this.audit.logRotationStarted(
				'generate',
				this.auditMetaFromGenerated(generateOptions, pendingCrypto),
			);
		} else {
			const pair = this.validateCertPair(body.signingCertPem, body.signingPrivateKeyPem);
			pendingCertPem = pair.certPem;
			pendingKeyPem = pair.privateKeyPem;
			pendingCrypto = pair.crypto;
			this.audit.logRotationStarted('upload');
		}

		const updated = await this.prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				pendingSigningCertPem: pendingCertPem,
				pendingSigningKeyEncrypted: this.encryptionService.encrypt(pendingKeyPem),
				rotationStartedAt: new Date(),
				...prismaCryptoPendingData(pendingCrypto),
			},
		});
		return toIdpSettingsPublicDto(updated, this.getIdpBaseUrl());
	}

	async completeRotation(): Promise<IdpSettingsPublicDto> {
		const settings = await this.findSettingsOrThrow();
		if (!settings.pendingSigningCertPem || !settings.pendingSigningKeyEncrypted) {
			throw new ConflictException('No certificate rotation in progress');
		}

		const updated = await this.prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				signingCertPem: settings.pendingSigningCertPem,
				signingKeyEncrypted: settings.pendingSigningKeyEncrypted,
				signingKeyFamily: settings.pendingSigningKeyFamily,
				signingSignatureAlgorithmId: settings.pendingSigningSignatureAlgorithmId,
				signingRsaModulusBits: settings.pendingSigningRsaModulusBits,
				signingEcCurve: settings.pendingSigningEcCurve,
				pendingSigningCertPem: null,
				pendingSigningKeyEncrypted: null,
				pendingSigningKeyFamily: null,
				pendingSigningSignatureAlgorithmId: null,
				pendingSigningRsaModulusBits: null,
				pendingSigningEcCurve: null,
				rotationStartedAt: null,
			},
		});
		this.audit.logRotationCompleted();
		return toIdpSettingsPublicDto(updated, this.getIdpBaseUrl());
	}

	async generatePrimaryEncryptionCert(
		body: GenerateIdpEncryptionCertRequestDto = {},
	): Promise<IdpSettingsPublicDto> {
		const settings = await this.findSettingsOrThrow();
		this.assertNoActiveEncryptionRotation(settings);

		const generated = this.generateEncryptionWithOptions(settings.entityId, body);
		const updated = await this.prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				encryptionCertPem: generated.certPem,
				encryptionKeyEncrypted: this.encryptionService.encrypt(generated.privateKeyPem),
				...prismaEncryptionPrimaryData(generated.metadata),
			},
		});
		this.audit.logEncryptionCertGenerated(
			false,
			this.auditMetaFromEncryptionGenerated(body, generated.metadata),
		);
		return toIdpSettingsPublicDto(updated, this.getIdpBaseUrl());
	}

	async uploadPrimaryEncryptionCert(
		body: UploadIdpEncryptionCertRequestDto,
	): Promise<IdpSettingsPublicDto> {
		const settings = await this.findSettingsOrThrow();
		this.assertNoActiveEncryptionRotation(settings);

		const pair = this.validateEncryptionCertPair(
			body.encryptionCertPem,
			body.encryptionPrivateKeyPem,
			settings.signingCertPem,
		);
		const updated = await this.prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				encryptionCertPem: pair.certPem,
				encryptionKeyEncrypted: this.encryptionService.encrypt(pair.privateKeyPem),
				...prismaEncryptionPrimaryData(pair.crypto),
			},
		});
		this.audit.logEncryptionCertUploaded(false);
		return toIdpSettingsPublicDto(updated, this.getIdpBaseUrl());
	}

	async startEncryptionRotation(
		body: StartIdpEncryptionCertRotationRequestDto,
	): Promise<IdpSettingsPublicDto> {
		const settings = await this.findSettingsOrThrow();
		if (!settings.encryptionCertPem || !settings.encryptionKeyEncrypted) {
			throw new ConflictException('Configure or generate primary encryption certificate first');
		}
		if (settings.pendingEncryptionCertPem || settings.pendingEncryptionKeyEncrypted) {
			throw new ConflictException('Encryption certificate rotation already in progress');
		}

		let pendingCertPem: string;
		let pendingKeyPem: string;
		let pendingCrypto;

		if (body.mode === 'generate') {
			const { mode, ...generateOptions } = body;
			void mode;
			const generated = this.generateEncryptionWithOptions(settings.entityId, generateOptions);
			pendingCertPem = generated.certPem;
			pendingKeyPem = generated.privateKeyPem;
			pendingCrypto = generated.metadata;
			this.audit.logEncryptionRotationStarted(
				'generate',
				this.auditMetaFromEncryptionGenerated(generateOptions, pendingCrypto),
			);
		} else {
			const pair = this.validateEncryptionCertPair(
				body.encryptionCertPem,
				body.encryptionPrivateKeyPem,
				settings.signingCertPem,
			);
			pendingCertPem = pair.certPem;
			pendingKeyPem = pair.privateKeyPem;
			pendingCrypto = pair.crypto;
			this.audit.logEncryptionRotationStarted('upload');
		}

		const updated = await this.prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				pendingEncryptionCertPem: pendingCertPem,
				pendingEncryptionKeyEncrypted: this.encryptionService.encrypt(pendingKeyPem),
				encryptionRotationStartedAt: new Date(),
				...prismaEncryptionPendingData(pendingCrypto),
			},
		});
		return toIdpSettingsPublicDto(updated, this.getIdpBaseUrl());
	}

	async completeEncryptionRotation(): Promise<IdpSettingsPublicDto> {
		const settings = await this.findSettingsOrThrow();
		if (!settings.pendingEncryptionCertPem || !settings.pendingEncryptionKeyEncrypted) {
			throw new ConflictException('No encryption certificate rotation in progress');
		}

		const updated = await this.prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				encryptionCertPem: settings.pendingEncryptionCertPem,
				encryptionKeyEncrypted: settings.pendingEncryptionKeyEncrypted,
				encryptionKeyFamily: settings.pendingEncryptionKeyFamily,
				encryptionKeyTransportAlgorithmId: settings.pendingEncryptionKeyTransportAlgorithmId,
				encryptionRsaModulusBits: settings.pendingEncryptionRsaModulusBits,
				encryptionEcCurve: settings.pendingEncryptionEcCurve,
				pendingEncryptionCertPem: null,
				pendingEncryptionKeyEncrypted: null,
				pendingEncryptionKeyFamily: null,
				pendingEncryptionKeyTransportAlgorithmId: null,
				pendingEncryptionRsaModulusBits: null,
				pendingEncryptionEcCurve: null,
				encryptionRotationStartedAt: null,
			},
		});
		this.audit.logEncryptionRotationCompleted();
		return toIdpSettingsPublicDto(updated, this.getIdpBaseUrl());
	}

	async cancelEncryptionRotation(): Promise<IdpSettingsPublicDto> {
		const settings = await this.findSettingsOrThrow();
		if (!settings.pendingEncryptionCertPem || !settings.pendingEncryptionKeyEncrypted) {
			throw new ConflictException('No encryption certificate rotation in progress');
		}

		const updated = await this.prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				pendingEncryptionCertPem: null,
				pendingEncryptionKeyEncrypted: null,
				pendingEncryptionKeyFamily: null,
				pendingEncryptionKeyTransportAlgorithmId: null,
				pendingEncryptionRsaModulusBits: null,
				pendingEncryptionEcCurve: null,
				encryptionRotationStartedAt: null,
			},
		});
		this.audit.logEncryptionRotationCancelled();
		return toIdpSettingsPublicDto(updated, this.getIdpBaseUrl());
	}

	async getEncryptionCertPublicPem(): Promise<{ certPem: string }> {
		const settings = await this.findSettingsOrThrow();
		if (!settings.encryptionCertPem) {
			throw new NotFoundException('IdP encryption certificate not configured');
		}
		return { certPem: settings.encryptionCertPem };
	}

	async cancelRotation(): Promise<IdpSettingsPublicDto> {
		const settings = await this.findSettingsOrThrow();
		if (!settings.pendingSigningCertPem || !settings.pendingSigningKeyEncrypted) {
			throw new ConflictException('No certificate rotation in progress');
		}

		const updated = await this.prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				pendingSigningCertPem: null,
				pendingSigningKeyEncrypted: null,
				pendingSigningKeyFamily: null,
				pendingSigningSignatureAlgorithmId: null,
				pendingSigningRsaModulusBits: null,
				pendingSigningEcCurve: null,
				rotationStartedAt: null,
			},
		});
		this.audit.logRotationCancelled();
		return toIdpSettingsPublicDto(updated, this.getIdpBaseUrl());
	}

	async getMetadataPreview(): Promise<IdpMetadataPreviewResponseDto> {
		const xml = await this.samlMetadataService.generateMetadata();
		return {
			xml,
			contentType: 'application/samlmetadata+xml',
		};
	}

	getMetadataUrlResponse(): Promise<IdpMetadataUrlResponseDto> {
		return this.findSettingsOrThrow().then((settings) =>
			buildMetadataUrlResponse(settings, this.getIdpBaseUrl()),
		);
	}

	buildDashboardIdpStatus(): Promise<AdminDashboardIdpStatusDto> {
		return this.findSettingsOrThrow().then((settings) => toDashboardIdpStatus(settings));
	}

	private generateWithOptions(entityId: string, options: GenerateIdpSigningCertRequestDto) {
		try {
			return this.idpSigningService.generateKeyPairAndCert(entityId, options);
		} catch (error) {
			this.rethrowCryptoValidation(error);
			throw error;
		}
	}

	private generateEncryptionWithOptions(
		entityId: string,
		options: GenerateIdpEncryptionCertRequestDto,
	) {
		try {
			return this.idpEncryptionService.generateKeyPairAndCert(entityId, options);
		} catch (error) {
			this.rethrowEncryptionCryptoValidation(error);
			throw error;
		}
	}

	private auditMetaFromEncryptionGenerated(
		options: GenerateIdpEncryptionCertRequestDto,
		metadata: StoredEncryptionCrypto,
	): EncryptionCertGeneratedAuditMeta {
		return {
			keyFamily: metadata.encryptionKeyFamily,
			keyTransportAlgorithmId: metadata.encryptionKeyTransportAlgorithmId ?? undefined,
			rsaModulusBits: metadata.encryptionRsaModulusBits ?? undefined,
			ecCurve: metadata.encryptionEcCurve ?? undefined,
			notAfter: options.notAfter,
		};
	}

	private auditMetaFromGenerated(
		options: GenerateIdpSigningCertRequestDto,
		metadata: {
			signingKeyFamily: string;
			signingSignatureAlgorithmId: string;
			signingRsaModulusBits: number | null;
			signingEcCurve: string | null;
		},
	): SigningCertGeneratedAuditMeta {
		return {
			keyFamily: metadata.signingKeyFamily,
			signatureAlgorithmId: metadata.signingSignatureAlgorithmId,
			rsaModulusBits: metadata.signingRsaModulusBits ?? undefined,
			ecCurve: metadata.signingEcCurve ?? undefined,
			notAfter: options.notAfter,
		};
	}

	private assertNoActiveRotation(settings: IdpSettings): void {
		if (settings.pendingSigningCertPem || settings.pendingSigningKeyEncrypted) {
			throw new ConflictException('Finish or cancel certificate rotation first');
		}
	}

	private assertNoActiveEncryptionRotation(settings: IdpSettings): void {
		if (settings.pendingEncryptionCertPem || settings.pendingEncryptionKeyEncrypted) {
			throw new ConflictException('Finish or cancel encryption certificate rotation first');
		}
	}

	private validateCertPair(certPem: string, privateKeyPem: string) {
		try {
			return validateSigningCertPair(certPem, privateKeyPem);
		} catch (error) {
			if (error instanceof IdpCertValidationError) {
				throw new BadRequestException(error.message);
			}
			this.rethrowCryptoValidation(error);
			throw error;
		}
	}

	private validateEncryptionCertPair(
		certPem: string,
		privateKeyPem: string,
		signingCertPem: string | null,
	) {
		try {
			return validateEncryptionKeyPair(certPem, privateKeyPem, signingCertPem);
		} catch (error) {
			if (error instanceof IdpCertValidationError) {
				throw new BadRequestException(error.message);
			}
			this.rethrowEncryptionCryptoValidation(error);
			throw error;
		}
	}

	private rethrowCryptoValidation(error: unknown): void {
		if (error instanceof IdpSigningCryptoValidationError) {
			throw new BadRequestException(error.message);
		}
	}

	private rethrowEncryptionCryptoValidation(error: unknown): void {
		if (error instanceof IdpEncryptionCryptoValidationError) {
			throw new BadRequestException(error.message);
		}
	}

	private async findSettingsOrThrow(): Promise<IdpSettings> {
		const settings = await this.prisma.idpSettings.findUnique({ where: { id: 'default' } });
		if (!settings) {
			throw new NotFoundException('IdP settings not configured');
		}
		return settings;
	}

	private getIdpBaseUrl(): string {
		return this.configService.get<string>('IDP_BASE_URL') ?? '';
	}
}
