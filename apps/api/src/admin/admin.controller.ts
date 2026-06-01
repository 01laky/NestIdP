import { Controller, Get, UseGuards } from '@nestjs/common';
import { API_CONNECTION_ROUTE_PREFIX, type AdminStubResponseDto } from '@nestidp/shared';
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
			note: 'API connection and SP connection CRUD will be implemented in a later prompt.',
			apiConnectionsRoute: API_CONNECTION_ROUTE_PREFIX,
			counts,
		};
	}
}
