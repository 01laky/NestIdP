import { Controller, Get } from '@nestjs/common';
import { API_CONNECTION_ROUTE_PREFIX, type AdminStubResponseDto } from '@nestidp/shared';
import { AdminStatsService } from './admin-stats.service';

@Controller('api/admin')
export class AdminController {
	constructor(private readonly adminStatsService: AdminStatsService) {}

	@Get()
	async getStub(): Promise<AdminStubResponseDto> {
		const counts = await this.adminStatsService.getCounts();

		return {
			status: 'stub',
			module: 'admin',
			note: 'API connection and SP connection CRUD will be implemented in a later prompt.',
			apiConnectionsRoute: API_CONNECTION_ROUTE_PREFIX,
			counts,
		};
	}
}
