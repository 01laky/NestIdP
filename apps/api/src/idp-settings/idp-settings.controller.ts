import { Body, Controller, Get, Patch, Post, UseGuards, ValidationPipe } from '@nestjs/common';
import {
	IDP_SETTINGS_API_PATH,
	type IdpMetadataPreviewResponseDto,
	type IdpSettingsPublicDto,
	type StartIdpCertRotationRequestDto,
} from '@nestidp/shared';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { AdminCsrfGuard } from '../admin-auth/admin-csrf.guard';
import { IdpSettingsService } from './idp-settings.service';
import { StartIdpCertRotationBodyDto } from './start-idp-cert-rotation.dto';
import { UpdateIdpSettingsBodyDto } from './update-idp-settings.dto';
import { UploadIdpSigningCertBodyDto } from './upload-idp-signing-cert.dto';

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
	generatePrimaryCert(): Promise<IdpSettingsPublicDto> {
		return this.idpSettingsService.generatePrimaryCert();
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
		return this.idpSettingsService.startRotation(body as StartIdpCertRotationRequestDto);
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

	@Get('metadata-preview')
	getMetadataPreview(): Promise<IdpMetadataPreviewResponseDto> {
		return this.idpSettingsService.getMetadataPreview();
	}
}
