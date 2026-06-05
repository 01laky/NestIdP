import { IdentityRepository } from '@api/identity/identity.repository';

describe('IdentityRepository', () => {
	const prisma = {
		user: { count: jest.fn() },
		group: { count: jest.fn() },
		role: { count: jest.fn() },
	};
	const repository = new IdentityRepository(prisma as never);

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('API-IDN-03: countUsers delegates to prisma.user.count', async () => {
		prisma.user.count.mockResolvedValue(7);
		await expect(repository.countUsers()).resolves.toBe(7);
		expect(prisma.user.count).toHaveBeenCalledWith();
	});

	it('API-IDN-04: countGroups delegates to prisma.group.count', async () => {
		prisma.group.count.mockResolvedValue(3);
		await expect(repository.countGroups()).resolves.toBe(3);
		expect(prisma.group.count).toHaveBeenCalledWith();
	});

	it('API-IDN-05: countRoles delegates to prisma.role.count', async () => {
		prisma.role.count.mockResolvedValue(2);
		await expect(repository.countRoles()).resolves.toBe(2);
		expect(prisma.role.count).toHaveBeenCalledWith();
	});

	it('API-IDN-06: propagates prisma errors from countUsers', async () => {
		prisma.user.count.mockRejectedValue(new Error('connection lost'));
		await expect(repository.countUsers()).rejects.toThrow('connection lost');
	});

	it('API-IDN-07: does not call group or role count when counting users only', async () => {
		prisma.user.count.mockResolvedValue(1);
		await repository.countUsers();
		expect(prisma.group.count).not.toHaveBeenCalled();
		expect(prisma.role.count).not.toHaveBeenCalled();
	});
});
