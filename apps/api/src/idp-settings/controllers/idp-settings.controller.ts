import { Body, Controller, Get, Patch, Post, UseGuards, ValidationPipe } from '@nestjs/common';
import {
	IDP_SETTINGS_API_PATH,
	type IdpCertRotationStatusDto,
	type IdpMetadataPreviewResponseDto,
	type IdpSettingsPublicDto,
} from '@nestidp/shared';
import { AdminAuthGuard } from '../../admin-auth/guards/admin-auth.guard';
import { AdminCsrfGuard } from '../../admin-auth/guards/admin-csrf.guard';
import { IdpSettingsService } from '../services/idp-settings.service';
import { GenerateIdpEncryptionCertBodyDto } from '../dto/generate-idp-encryption-cert.dto';
import { GenerateIdpSigningCertBodyDto } from '../dto/generate-idp-signing-cert.dto';
import {
	StartIdpCertRotationBodyDto,
	toStartIdpCertRotationRequest,
} from '../dto/start-idp-cert-rotation.dto';
import {
	StartIdpEncryptionCertRotationBodyDto,
	toStartIdpEncryptionCertRotationRequest,
} from '../dto/start-idp-encryption-cert-rotation.dto';
import { UpdateIdpSettingsBodyDto } from '../dto/update-idp-settings.dto';
import { UploadIdpEncryptionCertBodyDto } from '../dto/upload-idp-encryption-cert.dto';
import { UploadIdpSigningCertBodyDto } from '../dto/upload-idp-signing-cert.dto';

@Controller(IDP_SETTINGS_API_PATH)
@UseGuards(AdminAuthGuard)
export class IdpSettingsController {
	constructor(private readonly idpSettingsService: IdpSettingsService) {}

	@Get()
	getSettings(): Promise<IdpSettingsPublicDto> {
		return this.idpSettingsService.getSettings();
	}

	@Patch()
	@UseGuards(AdminCsrfGuard)
	updateSettings(
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: UpdateIdpSettingsBodyDto,
	): Promise<IdpSettingsPublicDto> {
		return this.idpSettingsService.updateSettings(body);
	}

	@Post('signing-cert/generate')
	@UseGuards(AdminCsrfGuard)
	generatePrimaryCert(
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: GenerateIdpSigningCertBodyDto,
	): Promise<IdpSettingsPublicDto> {
		return this.idpSettingsService.generatePrimaryCert(body);
	}

	@Post('signing-cert/upload')
	@UseGuards(AdminCsrfGuard)
	uploadPrimaryCert(
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: UploadIdpSigningCertBodyDto,
	): Promise<IdpSettingsPublicDto> {
		return this.idpSettingsService.uploadPrimaryCert(body);
	}

	@Post('signing-cert/rotation/start')
	@UseGuards(AdminCsrfGuard)
	startRotation(
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: StartIdpCertRotationBodyDto,
	): Promise<IdpSettingsPublicDto> {
		return this.idpSettingsService.startRotation(toStartIdpCertRotationRequest(body));
	}

	@Post('signing-cert/rotation/complete')
	@UseGuards(AdminCsrfGuard)
	completeRotation(): Promise<IdpSettingsPublicDto> {
		return this.idpSettingsService.completeRotation();
	}

	@Post('signing-cert/rotation/cancel')
	@UseGuards(AdminCsrfGuard)
	cancelRotation(): Promise<IdpSettingsPublicDto> {
		return this.idpSettingsService.cancelRotation();
	}

	@Post('encryption-cert/generate')
	@UseGuards(AdminCsrfGuard)
	generatePrimaryEncryptionCert(
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: GenerateIdpEncryptionCertBodyDto,
	): Promise<IdpSettingsPublicDto> {
		return this.idpSettingsService.generatePrimaryEncryptionCert(body);
	}

	@Post('encryption-cert/upload')
	@UseGuards(AdminCsrfGuard)
	uploadPrimaryEncryptionCert(
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: UploadIdpEncryptionCertBodyDto,
	): Promise<IdpSettingsPublicDto> {
		return this.idpSettingsService.uploadPrimaryEncryptionCert(body);
	}

	@Post('encryption-cert/rotation/start')
	@UseGuards(AdminCsrfGuard)
	startEncryptionRotation(
		@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
		body: StartIdpEncryptionCertRotationBodyDto,
	): Promise<IdpSettingsPublicDto> {
		return this.idpSettingsService.startEncryptionRotation(
			toStartIdpEncryptionCertRotationRequest(body),
		);
	}

	@Post('encryption-cert/rotation/complete')
	@UseGuards(AdminCsrfGuard)
	completeEncryptionRotation(): Promise<IdpSettingsPublicDto> {
		return this.idpSettingsService.completeEncryptionRotation();
	}

	@Post('encryption-cert/rotation/cancel')
	@UseGuards(AdminCsrfGuard)
	cancelEncryptionRotation(): Promise<IdpSettingsPublicDto> {
		return this.idpSettingsService.cancelEncryptionRotation();
	}

	@Get('cert-rotation/status')
	getCertRotationStatus(): Promise<IdpCertRotationStatusDto> {
		return this.idpSettingsService.getCertRotationStatus();
	}

	@Post('cert-rotation/run-check')
	@UseGuards(AdminCsrfGuard)
	runCertRotationCheck(): Promise<IdpSettingsPublicDto> {
		return this.idpSettingsService.runAutoRotationCheckOnDemand();
	}

	@Get('encryption-cert/public-pem')
	getEncryptionCertPublicPem(): Promise<{ certPem: string }> {
		return this.idpSettingsService.getEncryptionCertPublicPem();
	}

	@Get('metadata-preview')
	getMetadataPreview(): Promise<IdpMetadataPreviewResponseDto> {
		return this.idpSettingsService.getMetadataPreview();
	}
}
