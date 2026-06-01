import { API_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminController } from './admin.controller';
import { AdminStatsService } from './admin-stats.service';

describe('AdminController', () => {
	const adminStatsService = {
		getCounts: jest.fn(),
	};
	const controller = new AdminController(adminStatsService as unknown as AdminStatsService);

	beforeEach(() => {
		jest.clearAllMocks();
		adminStatsService.getCounts.mockResolvedValue({
			users: 1,
			groups: 2,
			roles: 3,
			apiConnections: 4,
			spConnections: 5,
		});
	});

	it('API-ADM-03: response includes counts with all five keys', async () => {
		const result = await controller.getStub();
		expect(result.counts).toEqual({
			users: 1,
			groups: 2,
			roles: 3,
			apiConnections: 4,
			spConnections: 5,
		});
	});

	it('API-ADM-04: exposes apiConnectionsRoute not sp prefix', async () => {
		const result = await controller.getStub();
		expect(result.apiConnectionsRoute).toBe(API_CONNECTION_ROUTE_PREFIX);
		expect(result.apiConnectionsRoute).toContain('api-connections');
		expect(result.apiConnectionsRoute).not.toContain('sp-connections');
	});

	it('API-ADM-05: counts values are numbers', async () => {
		const result = await controller.getStub();
		for (const value of Object.values(result.counts)) {
			expect(typeof value).toBe('number');
		}
	});

	it('API-ADM-06: uses AdminStatsService instead of Prisma directly', async () => {
		await controller.getStub();
		expect(adminStatsService.getCounts).toHaveBeenCalledTimes(1);
	});

	it('API-ADM-07: return value satisfies AdminStubResponseDto shape', async () => {
		const result = await controller.getStub();
		expect(result).toMatchObject({
			status: 'stub',
			module: 'admin',
			note: expect.any(String),
			apiConnectionsRoute: API_CONNECTION_ROUTE_PREFIX,
			counts: expect.objectContaining({
				users: expect.any(Number),
				groups: expect.any(Number),
				roles: expect.any(Number),
				apiConnections: expect.any(Number),
				spConnections: expect.any(Number),
			}),
		});
	});

	it('API-ADM-12: propagates AdminStatsService.getCounts errors', async () => {
		adminStatsService.getCounts.mockRejectedValue(new Error('stats unavailable'));
		await expect(controller.getStub()).rejects.toThrow('stats unavailable');
	});

	it('API-ADM-13: note still mentions deferred CRUD work', async () => {
		const result = await controller.getStub();
		expect(result.note.toLowerCase()).toContain('later prompt');
	});

	it('API-ADM-14: counts reflect service return values exactly', async () => {
		adminStatsService.getCounts.mockResolvedValue({
			users: 99,
			groups: 88,
			roles: 77,
			apiConnections: 66,
			spConnections: 55,
		});
		const result = await controller.getStub();
		expect(result.counts).toEqual({
			users: 99,
			groups: 88,
			roles: 77,
			apiConnections: 66,
			spConnections: 55,
		});
	});
});
