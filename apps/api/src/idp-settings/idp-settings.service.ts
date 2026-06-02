import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
	IdpMetadataPreviewResponseDto,
	IdpMetadataUrlResponseDto,
	IdpSettingsPublicDto,
	StartIdpCertRotationRequestDto,
	UpdateIdpSettingsRequestDto,
	UploadIdpSigningCertRequestDto,
} from '@nestidp/shared';
import type { AdminDashboardIdpStatusDto } from '@nestidp/shared';
import type { IdpSettings } from '@prisma/client';
import { EncryptionService } from '../encryption/encryption.service';
import { PrismaService } from '../prisma/prisma.service';
import { IdpSigningService } from '../saml/idp-signing.service';
import { SamlMetadataService } from '../saml/saml-metadata.service';
import { IdpCertValidationError, validateSigningCertPair } from './idp-cert.util';
import {
	assertValidIdpEntityId,
	assertValidIdpNameIdFormat,
	IdpEntityIdValidationError,
	IdpNameIdFormatValidationError,
} from './idp-entity-id.validator';
import { IdpSettingsAuditService } from './idp-settings-audit.service';
import {
	buildMetadataUrlResponse,
	toDashboardIdpStatus,
	toIdpSettingsPublicDto,
} from './idp-settings.mapper';

@Injectable()
export class IdpSettingsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
		private readonly encryptionService: EncryptionService,
		private readonly idpSigningService: IdpSigningService,
		private readonly samlMetadataService: SamlMetadataService,
		private readonly audit: IdpSettingsAuditService,
	) {}

	async getSettings(): Promise<IdpSettingsPublicDto> {
		const settings = await this.findSettingsOrThrow();
		return toIdpSettingsPublicDto(settings, this.getIdpBaseUrl());
	}

	async updateSettings(body: UpdateIdpSettingsRequestDto): Promise<IdpSettingsPublicDto> {
		if (body.entityId === undefined && body.nameIdFormat === undefined) {
			throw new BadRequestException('At least one field is required');
		}

		const data: Partial<Pick<IdpSettings, 'entityId' | 'nameIdFormat'>> = {};
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

		const updated = await this.prisma.idpSettings.update({
			where: { id: 'default' },
			data,
		});
		this.audit.logSettingsUpdated(updatedFields);
		return toIdpSettingsPublicDto(updated, this.getIdpBaseUrl());
	}

	async generatePrimaryCert(): Promise<IdpSettingsPublicDto> {
		const settings = await this.findSettingsOrThrow();
		this.assertNoActiveRotation(settings);

		const { privateKeyPem, certPem } = this.idpSigningService.generateKeyPairAndCert(
			settings.entityId,
		);
		const updated = await this.prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				signingCertPem: certPem,
				signingKeyEncrypted: this.encryptionService.encrypt(privateKeyPem),
			},
		});
		this.audit.logSigningCertGenerated(false);
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

		if (body.mode === 'generate') {
			const generated = this.idpSigningService.generateKeyPairAndCert(settings.entityId);
			pendingCertPem = generated.certPem;
			pendingKeyPem = generated.privateKeyPem;
			this.audit.logRotationStarted('generate');
		} else {
			const pair = this.validateCertPair(body.signingCertPem, body.signingPrivateKeyPem);
			pendingCertPem = pair.certPem;
			pendingKeyPem = pair.privateKeyPem;
			this.audit.logRotationStarted('upload');
		}

		const updated = await this.prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				pendingSigningCertPem: pendingCertPem,
				pendingSigningKeyEncrypted: this.encryptionService.encrypt(pendingKeyPem),
				rotationStartedAt: new Date(),
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
				pendingSigningCertPem: null,
				pendingSigningKeyEncrypted: null,
				rotationStartedAt: null,
			},
		});
		this.audit.logRotationCompleted();
		return toIdpSettingsPublicDto(updated, this.getIdpBaseUrl());
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

	private assertNoActiveRotation(settings: IdpSettings): void {
		if (settings.pendingSigningCertPem || settings.pendingSigningKeyEncrypted) {
			throw new ConflictException('Finish or cancel certificate rotation first');
		}
	}

	private validateCertPair(certPem: string, privateKeyPem: string) {
		try {
			return validateSigningCertPair(certPem, privateKeyPem);
		} catch (error) {
			if (error instanceof IdpCertValidationError) {
				throw new BadRequestException(error.message);
			}
			throw error;
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
