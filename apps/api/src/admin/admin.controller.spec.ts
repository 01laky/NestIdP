import { API_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminController } from './admin.controller';

describe('AdminController', () => {
	const controller = new AdminController();

	it('returns admin stub payload with API connections route prefix', () => {
		const result = controller.getStub();
		expect(result).toEqual({
			status: 'stub',
			module: 'admin',
			note: 'API connection and SP connection CRUD will be implemented in a later prompt.',
			apiConnectionsRoute: API_CONNECTION_ROUTE_PREFIX,
		});
	});

	it('uses identity-source route prefix not SP prefix', () => {
		const result = controller.getStub();
		expect(result.apiConnectionsRoute).toContain('api-connections');
		expect(result.apiConnectionsRoute).not.toContain('sp-connections');
	});
});
