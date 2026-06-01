import { Controller, Get, UseGuards } from '@nestjs/common';
import {
	API_CONNECTION_ROUTE_PREFIX,
	API_CONNECTIONS_API_PATH,
	SYNC_API_PATH,
	type AdminStubResponseDto,
} from '@nestidp/shared';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { AdminStatsService } from './admin-stats.service';

@Controller('api/admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
	constructor(private readonly adminStatsService: AdminStatsService) {}

	@Get()
	async getStub(): Promise<AdminStubResponseDto> {
		const counts = await this.adminStatsService.getCounts();

		return {
			status: 'stub',
			module: 'admin',
			note: 'API connection CRUD, connectivity test, and identity sync available via REST; admin UI pages in a later release.',
			apiConnectionsRoute: API_CONNECTION_ROUTE_PREFIX,
			apiConnectionsApiPath: API_CONNECTIONS_API_PATH,
			syncApiPath: SYNC_API_PATH,
			counts,
		};
	}
}
