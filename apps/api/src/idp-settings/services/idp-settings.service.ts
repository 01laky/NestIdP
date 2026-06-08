import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	Logger,
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
import { redactSecrets } from '../../encryption/utils/redact-secret.util';
import { PrismaService } from '../../prisma/services/prisma.service';
import { IdpEncryptionService } from '../../saml/services/idp-encryption.service';
import { IdpSigningService } from '../../saml/services/idp-signing.service';
import { SamlMetadataService } from '../../saml/services/saml-metadata.service';
import {
	IdpCertValidationError,
	isCertExpiringSoon,
	parseCertNotAfterIso,
	prismaCryptoPendingData,
	prismaCryptoPrimaryData,
	validateSigningCertPair,
} from '../utils/idp-cert.util';
import { CertRotationConfig } from '../cert-rotation.config';
import {
	CERT_ROTATION_NOTIFIER,
	type CertRotationKind,
	type CertRotationNotifier,
} from '../cert-rotation-notifier';
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
		private readonly certRotationConfig: CertRotationConfig,
		@Inject(CERT_ROTATION_NOTIFIER)
		private readonly certRotationNotifier: CertRotationNotifier,
	) {}

	private readonly autoLogger = new Logger('CertRotation');

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
			body.wantAuthnRequestsSigned === undefined &&
			body.autoRotateSigningEnabled === undefined &&
			body.autoRotateEncryptionEnabled === undefined
		) {
			throw new BadRequestException('At least one field is required');
		}

		const data: Partial<
			Pick<
				IdpSettings,
				| 'entityId'
				| 'nameIdFormat'
				| 'wantAuthnRequestsSigned'
				| 'autoRotateSigningEnabled'
				| 'autoRotateEncryptionEnabled'
				| 'signingAutoRotationConsecutiveFailures'
				| 'signingAutoRotationDisabledAt'
				| 'signingAutoRotationLastError'
				| 'encryptionAutoRotationConsecutiveFailures'
				| 'encryptionAutoRotationDisabledAt'
				| 'encryptionAutoRotationLastError'
			>
		> = {};
		const updatedFields: string[] = [];
		const autoRotationFields: string[] = [];

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

		// Auto-rotation toggles — re-enabling clears the failure backoff for that cert (Prompt 34).
		if (body.autoRotateSigningEnabled !== undefined) {
			data.autoRotateSigningEnabled = body.autoRotateSigningEnabled;
			autoRotationFields.push('autoRotateSigningEnabled');
			if (body.autoRotateSigningEnabled) {
				data.signingAutoRotationConsecutiveFailures = 0;
				data.signingAutoRotationDisabledAt = null;
				data.signingAutoRotationLastError = null;
			}
		}
		if (body.autoRotateEncryptionEnabled !== undefined) {
			data.autoRotateEncryptionEnabled = body.autoRotateEncryptionEnabled;
			autoRotationFields.push('autoRotateEncryptionEnabled');
			if (body.autoRotateEncryptionEnabled) {
				data.encryptionAutoRotationConsecutiveFailures = 0;
				data.encryptionAutoRotationDisabledAt = null;
				data.encryptionAutoRotationLastError = null;
			}
		}

		const updated = await this.prisma.idpSettings.update({
			where: { id: 'default' },
			data,
		});
		if (updatedFields.length > 0) {
			this.audit.logSettingsUpdated(updatedFields);
		}
		if (autoRotationFields.length > 0) {
			this.audit.logAutoRotationSettingChanged(autoRotationFields);
		}
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

	// =============================================================================================
	// Automatic certificate rotation (Prompt 34) — the time-driven driver over the manual primitives.
	// =============================================================================================

	/**
	 * Evaluate + drive auto-rotation for both certs. Called by the scheduler each tick and by the
	 * on-demand admin endpoint. Signing and encryption are independent; a failure on one never affects
	 * the other; nothing throws out of here.
	 */
	private autoRotationInFlight = false;

	async runAutoRotationCheck(opts: {
		trigger: 'scheduled' | 'manual' | 'boot';
		dryRun?: boolean;
	}): Promise<IdpSettingsPublicDto> {
		// Shared re-entrancy guard: the scheduled tick and the on-demand check can never overlap (key
		// generation shells out to openssl). A concurrent caller gets the current state, untouched.
		if (this.autoRotationInFlight) {
			return this.getSettings();
		}
		this.autoRotationInFlight = true;
		try {
			const dryRun = opts.dryRun ?? this.certRotationConfig.dryRun();
			const now = new Date();
			let settings = await this.findSettingsOrThrow();

			for (const kind of ['signing', 'encryption'] as CertRotationKind[]) {
				try {
					settings = await this.evaluateAutoRotationForKind(
						kind,
						settings,
						now,
						opts.trigger,
						dryRun,
					);
				} catch (error) {
					settings = await this.recordAutoRotationFailure(kind, settings, error);
				}
			}

			const updated = await this.prisma.idpSettings.update({
				where: { id: 'default' },
				data: { lastAutoRotationCheckAt: now },
			});
			return toIdpSettingsPublicDto(updated, this.getIdpBaseUrl());
		} finally {
			this.autoRotationInFlight = false;
		}
	}

	/** On-demand admin trigger for one evaluation (honours dry-run); audited as an admin action. */
	async runAutoRotationCheckOnDemand(): Promise<IdpSettingsPublicDto> {
		this.audit.logAutoRotationCheckRun(this.certRotationConfig.dryRun());
		return this.runAutoRotationCheck({ trigger: 'manual' });
	}

	private async evaluateAutoRotationForKind(
		kind: CertRotationKind,
		settings: IdpSettings,
		now: Date,
		trigger: 'scheduled' | 'manual' | 'boot',
		dryRun: boolean,
	): Promise<IdpSettings> {
		const enabled =
			kind === 'signing' ? settings.autoRotateSigningEnabled : settings.autoRotateEncryptionEnabled;
		const disabledAt =
			kind === 'signing'
				? settings.signingAutoRotationDisabledAt
				: settings.encryptionAutoRotationDisabledAt;
		if (!enabled || disabledAt) {
			return settings;
		}
		const activeCertPem = kind === 'signing' ? settings.signingCertPem : settings.encryptionCertPem;
		if (!activeCertPem) {
			return settings; // never bootstraps the first cert
		}
		const rotationActive =
			kind === 'signing'
				? Boolean(settings.pendingSigningCertPem)
				: Boolean(settings.pendingEncryptionCertPem);

		if (rotationActive) {
			const startedAt =
				kind === 'signing' ? settings.rotationStartedAt : settings.encryptionRotationStartedAt;
			const overlapMs = this.effectiveOverlapDays(kind, activeCertPem, now) * 86_400_000;
			if (startedAt && now.getTime() >= startedAt.getTime() + overlapMs) {
				return this.autoCompleteKind(kind, now, dryRun);
			}
			return settings; // overlap not elapsed — wait
		}

		const notAfter = parseCertNotAfterIso(activeCertPem);
		if (isCertExpiringSoon(notAfter, this.certRotationConfig.leadDays(kind))) {
			if (trigger === 'boot' && !this.withinBootGrace(notAfter, now)) {
				return settings; // defer surprise rotation right after a deploy
			}
			return this.autoStartKind(kind, settings, now, dryRun);
		}
		if (isCertExpiringSoon(notAfter, this.certRotationConfig.notifyLeadDays())) {
			this.certRotationNotifier.onAutoRotationDueSoon({ kind, activeCertNotAfter: notAfter });
			this.audit.logAutoRotationDueSoon(kind, notAfter);
		}
		return settings;
	}

	private async autoStartKind(
		kind: CertRotationKind,
		settings: IdpSettings,
		now: Date,
		dryRun: boolean,
	): Promise<IdpSettings> {
		const notAfter = this.notAfterFromDays(this.certRotationConfig.validityDays(), now);
		if (dryRun) {
			this.audit.logAutoRotationStarted(kind, true, { notAfter, would: 'auto_start' });
			this.certRotationNotifier.onAutoRotationStarted({ kind, dryRun: true });
			return settings;
		}

		let pendingData: Record<string, unknown>;
		if (kind === 'signing') {
			const generated = this.generateWithOptions(settings.entityId, {
				keyFamily: (settings.signingKeyFamily as never) ?? undefined,
				rsaModulusBits: (settings.signingRsaModulusBits as never) ?? undefined,
				ecCurve: (settings.signingEcCurve as never) ?? undefined,
				signatureAlgorithmId: settings.signingSignatureAlgorithmId ?? undefined,
				notAfter,
			});
			pendingData = {
				pendingSigningCertPem: generated.certPem,
				pendingSigningKeyEncrypted: this.encryptionService.encrypt(generated.privateKeyPem),
				rotationStartedAt: now,
				...prismaCryptoPendingData(generated.metadata),
			};
		} else {
			const generated = this.generateEncryptionWithOptions(settings.entityId, {
				keyFamily: (settings.encryptionKeyFamily as never) ?? undefined,
				rsaModulusBits: (settings.encryptionRsaModulusBits as never) ?? undefined,
				ecCurve: (settings.encryptionEcCurve as never) ?? undefined,
				keyTransportAlgorithmId: settings.encryptionKeyTransportAlgorithmId ?? undefined,
				notAfter,
			});
			pendingData = {
				pendingEncryptionCertPem: generated.certPem,
				pendingEncryptionKeyEncrypted: this.encryptionService.encrypt(generated.privateKeyPem),
				encryptionRotationStartedAt: now,
				...prismaEncryptionPendingData(generated.metadata),
			};
		}

		const updated = await this.prisma.idpSettings.update({
			where: { id: 'default' },
			data: {
				...pendingData,
				lastAutoRotationActionAt: now,
				...this.clearFailureData(kind),
			},
		});
		this.audit.logAutoRotationStarted(kind, false, { notAfter });
		this.certRotationNotifier.onAutoRotationStarted({
			kind,
			pendingCertNotAfter: notAfter,
			willAutoCompleteAt: this.notAfterFromDays(this.certRotationConfig.overlapDays(kind), now),
		});
		return updated;
	}

	private async autoCompleteKind(
		kind: CertRotationKind,
		now: Date,
		dryRun: boolean,
	): Promise<IdpSettings> {
		const settings = await this.findSettingsOrThrow();
		if (dryRun) {
			this.audit.logAutoRotationCompleted(kind, true);
			this.certRotationNotifier.onAutoRotationCompleted({ kind, dryRun: true });
			return settings;
		}

		const promotion =
			kind === 'signing'
				? {
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
					}
				: {
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
					};

		const updated = await this.prisma.idpSettings.update({
			where: { id: 'default' },
			data: { ...promotion, lastAutoRotationActionAt: now, ...this.clearFailureData(kind) },
		});
		this.audit.logAutoRotationCompleted(kind, false);
		this.certRotationNotifier.onAutoRotationCompleted({ kind });
		return updated;
	}

	private async recordAutoRotationFailure(
		kind: CertRotationKind,
		settings: IdpSettings,
		error: unknown,
	): Promise<IdpSettings> {
		const reason = redactSecrets(error instanceof Error ? error.message : String(error));
		const prev =
			kind === 'signing'
				? settings.signingAutoRotationConsecutiveFailures
				: settings.encryptionAutoRotationConsecutiveFailures;
		const count = prev + 1;
		const threshold = this.certRotationConfig.failureAutodisableThreshold();
		const autodisable = threshold > 0 && count >= threshold;
		this.autoLogger.warn(
			JSON.stringify({ event: 'cert_rotation_tick_error', kind, count, reason }),
		);

		const data =
			kind === 'signing'
				? {
						signingAutoRotationConsecutiveFailures: count,
						signingAutoRotationLastError: reason,
						...(autodisable ? { signingAutoRotationDisabledAt: new Date() } : {}),
					}
				: {
						encryptionAutoRotationConsecutiveFailures: count,
						encryptionAutoRotationLastError: reason,
						...(autodisable ? { encryptionAutoRotationDisabledAt: new Date() } : {}),
					};
		const updated = await this.prisma.idpSettings.update({ where: { id: 'default' }, data });
		this.audit.logAutoRotationFailed(kind, reason, count);
		if (autodisable) {
			this.audit.logAutoRotationAutodisabled(kind, count);
		}
		this.certRotationNotifier.onAutoRotationFailed({ kind, reason });
		return updated;
	}

	/** Clear the per-cert failure backoff after a successful auto transition. */
	private clearFailureData(kind: CertRotationKind): Record<string, unknown> {
		return kind === 'signing'
			? { signingAutoRotationConsecutiveFailures: 0, signingAutoRotationLastError: null }
			: { encryptionAutoRotationConsecutiveFailures: 0, encryptionAutoRotationLastError: null };
	}

	/** Overlap clamped so it always fits before the active cert expires (0 if already expired). */
	private effectiveOverlapDays(kind: CertRotationKind, activeCertPem: string, now: Date): number {
		const configured = this.certRotationConfig.overlapDays(kind);
		const notAfter = parseCertNotAfterIso(activeCertPem);
		if (!notAfter) {
			return configured;
		}
		const daysLeft = Math.floor((new Date(notAfter).getTime() - now.getTime()) / 86_400_000);
		if (daysLeft <= 0) {
			return 0;
		}
		return Math.max(0, Math.min(configured, daysLeft));
	}

	/** On boot, only act immediately when the cert expires within the boot grace window. */
	private withinBootGrace(notAfter: string | null, now: Date): boolean {
		const graceHours = this.certRotationConfig.bootGraceHours();
		if (!notAfter) {
			return false;
		}
		const hoursLeft = (new Date(notAfter).getTime() - now.getTime()) / 3_600_000;
		return hoursLeft <= graceHours;
	}

	private notAfterFromDays(days: number, now: Date): string {
		return new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
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
