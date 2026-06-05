import { AdminStatsService } from '@api/admin/services/admin-stats.service';

describe('AdminStatsService', () => {
	const identityService = {
		countUsers: jest.fn(),
		countGroups: jest.fn(),
		countRoles: jest.fn(),
	};
	const prisma = {
		apiConnection: { count: jest.fn() },
		spConnection: { count: jest.fn() },
	};
	const service = new AdminStatsService(identityService as never, prisma as never);

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('API-ADM-01: aggregates identity counts and connection counts', async () => {
		identityService.countUsers.mockResolvedValue(10);
		identityService.countGroups.mockResolvedValue(4);
		identityService.countRoles.mockResolvedValue(2);
		prisma.apiConnection.count.mockResolvedValue(1);
		prisma.spConnection.count.mockResolvedValue(3);

		await expect(service.getCounts()).resolves.toEqual({
			users: 10,
			groups: 4,
			roles: 2,
			apiConnections: 1,
			spConnections: 3,
		});
	});

	it('API-ADM-02: returns zeros when database is empty', async () => {
		identityService.countUsers.mockResolvedValue(0);
		identityService.countGroups.mockResolvedValue(0);
		identityService.countRoles.mockResolvedValue(0);
		prisma.apiConnection.count.mockResolvedValue(0);
		prisma.spConnection.count.mockResolvedValue(0);

		await expect(service.getCounts()).resolves.toEqual({
			users: 0,
			groups: 0,
			roles: 0,
			apiConnections: 0,
			spConnections: 0,
		});
	});

	it('API-ADM-08: runs all count queries in parallel', async () => {
		identityService.countUsers.mockResolvedValue(1);
		identityService.countGroups.mockResolvedValue(1);
		identityService.countRoles.mockResolvedValue(1);
		prisma.apiConnection.count.mockResolvedValue(1);
		prisma.spConnection.count.mockResolvedValue(1);

		await service.getCounts();

		expect(identityService.countUsers).toHaveBeenCalledTimes(1);
		expect(identityService.countGroups).toHaveBeenCalledTimes(1);
		expect(identityService.countRoles).toHaveBeenCalledTimes(1);
		expect(prisma.apiConnection.count).toHaveBeenCalledTimes(1);
		expect(prisma.spConnection.count).toHaveBeenCalledTimes(1);
	});

	it('API-ADM-09: propagates identityService.countUsers failure', async () => {
		identityService.countUsers.mockRejectedValue(new Error('identity count failed'));
		await expect(service.getCounts()).rejects.toThrow('identity count failed');
	});

	it('API-ADM-10: propagates prisma.apiConnection.count failure', async () => {
		identityService.countUsers.mockResolvedValue(0);
		identityService.countGroups.mockResolvedValue(0);
		identityService.countRoles.mockResolvedValue(0);
		prisma.apiConnection.count.mockRejectedValue(new Error('connection count failed'));
		await expect(service.getCounts()).rejects.toThrow('connection count failed');
	});

	it('API-ADM-11: does not swallow partial success when spConnection count fails', async () => {
		identityService.countUsers.mockResolvedValue(5);
		identityService.countGroups.mockResolvedValue(0);
		identityService.countRoles.mockResolvedValue(0);
		prisma.apiConnection.count.mockResolvedValue(1);
		prisma.spConnection.count.mockRejectedValue(new Error('sp count failed'));
		await expect(service.getCounts()).rejects.toThrow('sp count failed');
	});
});
