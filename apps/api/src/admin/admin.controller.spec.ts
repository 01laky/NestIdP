import {
	API_CONNECTION_ROUTE_PREFIX,
	API_CONNECTIONS_API_PATH,
	SP_CONNECTION_ROUTE_PREFIX,
	SYNC_API_PATH,
} from '@nestidp/shared';
import { AdminController } from './admin.controller';
import { AdminDashboardService } from './admin-dashboard.service';

describe('AdminController', () => {
	const adminDashboardService = {
		getDashboard: jest.fn(),
	};
	const controller = new AdminController(adminDashboardService as unknown as AdminDashboardService);

	beforeEach(() => {
		jest.clearAllMocks();
		adminDashboardService.getDashboard.mockResolvedValue({
			counts: {
				users: 1,
				groups: 2,
				roles: 3,
				apiConnections: 4,
				spConnections: 5,
			},
			apiConnectionsRoute: API_CONNECTION_ROUTE_PREFIX,
			spConnectionsRoute: SP_CONNECTION_ROUTE_PREFIX,
			identityUsersRoute: '/admin/identity/users',
			apiConnectionsApiPath: API_CONNECTIONS_API_PATH,
			syncApiPath: SYNC_API_PATH,
			spConnectionsApiPath: '/api/admin/sp-connections',
			metadataUrl: 'http://localhost:3000/saml/metadata',
			entityId: 'http://localhost:3000',
			ssoUrl: 'http://localhost:3000/saml/sso',
			apiConnection: null,
			lastSyncStatus: null,
			lastSyncAt: null,
		});
	});

	it('API-ADM-03: response includes counts with all five keys', async () => {
		const result = await controller.getDashboard();
		expect(result.counts).toEqual({
			users: 1,
			groups: 2,
			roles: 3,
			apiConnections: 4,
			spConnections: 5,
		});
	});

	it('API-ADM-04: exposes apiConnectionsRoute not sp prefix', async () => {
		const result = await controller.getDashboard();
		expect(result.apiConnectionsRoute).toBe(API_CONNECTION_ROUTE_PREFIX);
		expect(result.apiConnectionsRoute).toContain('api-connections');
		expect(result.apiConnectionsRoute).not.toContain('sp-connections');
	});

	it('API-ADM-05: counts values are numbers', async () => {
		const result = await controller.getDashboard();
		for (const value of Object.values(result.counts)) {
			expect(typeof value).toBe('number');
		}
	});

	it('API-ADM-06: uses AdminDashboardService instead of Prisma directly', async () => {
		await controller.getDashboard();
		expect(adminDashboardService.getDashboard).toHaveBeenCalledTimes(1);
	});

	it('API-ADM-07: return value satisfies AdminDashboardResponseDto shape', async () => {
		const result = await controller.getDashboard();
		expect(result).toMatchObject({
			apiConnectionsRoute: API_CONNECTION_ROUTE_PREFIX,
			spConnectionsRoute: SP_CONNECTION_ROUTE_PREFIX,
			apiConnectionsApiPath: API_CONNECTIONS_API_PATH,
			syncApiPath: SYNC_API_PATH,
			metadataUrl: expect.any(String),
			entityId: expect.any(String),
			ssoUrl: expect.any(String),
			counts: expect.objectContaining({
				users: expect.any(Number),
				groups: expect.any(Number),
				roles: expect.any(Number),
				apiConnections: expect.any(Number),
				spConnections: expect.any(Number),
			}),
		});
	});

	it('API-ADM-12: propagates AdminDashboardService errors', async () => {
		adminDashboardService.getDashboard.mockRejectedValue(new Error('stats unavailable'));
		await expect(controller.getDashboard()).rejects.toThrow('stats unavailable');
	});

	it('API-ADM-13: includes identity users route prefix', async () => {
		const result = await controller.getDashboard();
		expect(result.identityUsersRoute).toContain('/admin/identity');
	});

	it('API-ADM-14: counts reflect service return values exactly', async () => {
		adminDashboardService.getDashboard.mockResolvedValue({
			counts: {
				users: 99,
				groups: 88,
				roles: 77,
				apiConnections: 66,
				spConnections: 55,
			},
			apiConnectionsRoute: API_CONNECTION_ROUTE_PREFIX,
			spConnectionsRoute: SP_CONNECTION_ROUTE_PREFIX,
			identityUsersRoute: '/admin/identity/users',
			apiConnectionsApiPath: API_CONNECTIONS_API_PATH,
			syncApiPath: SYNC_API_PATH,
			spConnectionsApiPath: '/api/admin/sp-connections',
			metadataUrl: 'http://localhost:3000/saml/metadata',
			entityId: 'http://localhost:3000',
			ssoUrl: 'http://localhost:3000/saml/sso',
			apiConnection: null,
			lastSyncStatus: 'SUCCESS',
			lastSyncAt: '2026-01-01T00:00:00.000Z',
		});
		const result = await controller.getDashboard();
		expect(result.counts).toEqual({
			users: 99,
			groups: 88,
			roles: 77,
			apiConnections: 66,
			spConnections: 55,
		});
		expect(result.lastSyncStatus).toBe('SUCCESS');
	});
});
