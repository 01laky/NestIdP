import { Controller, Get } from '@nestjs/common';
import { API_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';

@Controller('api/admin')
export class AdminController {
	@Get()
	getStub() {
		return {
			status: 'stub',
			module: 'admin',
			note: 'API connection and SP connection CRUD will be implemented in a later prompt.',
			apiConnectionsRoute: API_CONNECTION_ROUTE_PREFIX,
		};
	}
}
