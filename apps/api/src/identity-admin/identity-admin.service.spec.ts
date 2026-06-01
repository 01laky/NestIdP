import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IdentityAdminService } from './identity-admin.service';

describe('IdentityAdminService', () => {
	const prisma = {
		user: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
		group: { findMany: jest.fn(), count: jest.fn() },
		role: { findMany: jest.fn(), count: jest.fn() },
	};

	const service = new IdentityAdminService(prisma as never);

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('API-IDN-SVC-01: listUsers default limit 50', async () => {
		prisma.user.findMany.mockResolvedValue([]);
		prisma.user.count.mockResolvedValue(0);

		await service.listUsers();

		expect(prisma.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ take: 50, skip: 0 }),
		);
	});

	it('API-IDN-SVC-02: listUsers invalid limit → BadRequestException', async () => {
		await expect(service.listUsers(0)).rejects.toThrow(BadRequestException);
		await expect(service.listUsers(9999)).rejects.toThrow('limit must be between 1 and 200');
		await expect(service.listUsers(Number.NaN)).rejects.toThrow(BadRequestException);
	});

	it('API-IDN-SVC-03: listUsers negative offset → BadRequestException', async () => {
		await expect(service.listUsers(undefined, -1)).rejects.toThrow(
			'offset must be a non-negative number',
		);
	});

	it('API-IDN-SVC-04: search builds OR on username and email', async () => {
		prisma.user.findMany.mockResolvedValue([]);
		prisma.user.count.mockResolvedValue(0);

		await service.listUsers(undefined, undefined, '  alice  ');

		expect(prisma.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					OR: [{ username: { contains: 'alice' } }, { email: { contains: 'alice' } }],
				},
			}),
		);
	});

	it('API-IDN-SVC-05: whitespace-only search uses empty where', async () => {
		prisma.user.findMany.mockResolvedValue([]);
		prisma.user.count.mockResolvedValue(0);

		await service.listUsers(undefined, undefined, '   ');

		expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
	});

	it('API-IDN-SVC-06: getUserById unknown → NotFoundException', async () => {
		prisma.user.findUnique.mockResolvedValue(null);
		await expect(service.getUserById('c1234567890123456789012345')).rejects.toThrow(
			NotFoundException,
		);
	});

	it('API-IDN-SVC-07: getUserById sorts groups and roles by name', async () => {
		prisma.user.findUnique.mockResolvedValue({
			id: 'u1',
			username: 'alice',
			email: null,
			displayName: null,
			active: true,
			externalId: 'ext-1',
			apiConnectionId: 'conn-1',
			groups: [{ group: { id: 'g2', name: 'zeta' } }, { group: { id: 'g1', name: 'alpha' } }],
			roles: [{ role: { id: 'r2', name: 'viewer' } }, { role: { id: 'r1', name: 'admin' } }],
		});

		const result = await service.getUserById('u1');

		expect(result.groups.map((g) => g.name)).toEqual(['alpha', 'zeta']);
		expect(result.roles.map((r) => r.name)).toEqual(['admin', 'viewer']);
	});

	it('API-IDN-SVC-08: listGroups returns total count', async () => {
		prisma.group.findMany.mockResolvedValue([
			{ id: 'g1', name: 'a', externalId: 'e', apiConnectionId: 'c' },
		]);
		prisma.group.count.mockResolvedValue(1);

		const result = await service.listGroups(10, 0);
		expect(result.total).toBe(1);
		expect(result.items).toHaveLength(1);
	});
});
