import { Controller, Get, UseGuards } from '@nestjs/common';
import type { IdpMetadataUrlResponseDto } from '@nestidp/shared';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { SpConnectionsService } from './sp-connections.service';

@Controller('api/admin')
@UseGuards(AdminAuthGuard)
export class IdpMetadataController {
	constructor(private readonly spConnectionsService: SpConnectionsService) {}

	@Get('idp/metadata-url')
	getMetadataUrl(): Promise<IdpMetadataUrlResponseDto> {
		return this.spConnectionsService.getMetadataUrl();
	}
}
