import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { IdpMetadataUrlResponseDto, SpConnectionListResponseDto } from '@nestidp/shared';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { ParseCuidPipe } from '../common/parse-cuid.pipe';
import { SpConnectionsService } from './sp-connections.service';

@Controller('api/admin')
@UseGuards(AdminAuthGuard)
export class SpConnectionsController {
	constructor(private readonly spConnectionsService: SpConnectionsService) {}

	@Get('sp-connections')
	list(): Promise<SpConnectionListResponseDto> {
		return this.spConnectionsService.list();
	}

	@Get('sp-connections/:id')
	getById(@Param('id', ParseCuidPipe) id: string) {
		return this.spConnectionsService.getById(id);
	}

	@Get('idp/metadata-url')
	getMetadataUrl(): Promise<IdpMetadataUrlResponseDto> {
		return this.spConnectionsService.getMetadataUrl();
	}
}
