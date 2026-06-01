import { Controller, Get, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
	API_CONNECTION_ROUTE_PREFIX,
	API_CONNECTIONS_API_PATH,
	SAML_METADATA_PATH,
	SP_CONNECTIONS_API_PATH,
	SYNC_API_PATH,
	type AdminStubResponseDto,
} from '@nestidp/shared';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { AdminStatsService } from './admin-stats.service';

@Controller('api/admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
	constructor(
		private readonly adminStatsService: AdminStatsService,
		private readonly configService: ConfigService,
	) {}

	@Get()
	async getStub(): Promise<AdminStubResponseDto> {
		const counts = await this.adminStatsService.getCounts();

		const base = (this.configService.get<string>('IDP_BASE_URL') ?? '').replace(/\/+$/, '');
		return {
			status: 'stub',
			module: 'admin',
			note: 'API connection CRUD, connectivity test, and identity sync available via REST; admin UI pages in a later release.',
			apiConnectionsRoute: API_CONNECTION_ROUTE_PREFIX,
			apiConnectionsApiPath: API_CONNECTIONS_API_PATH,
			syncApiPath: SYNC_API_PATH,
			spConnectionsApiPath: SP_CONNECTIONS_API_PATH,
			metadataUrl: `${base}${SAML_METADATA_PATH}`,
			counts,
		};
	}
}
