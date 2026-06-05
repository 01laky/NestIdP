import { IdentityRepository } from '@api/identity/identity.repository';
import { IdentityService } from '@api/identity/services/identity.service';

describe('IdentityService', () => {
	const repository = {
		countUsers: jest.fn(),
		countGroups: jest.fn(),
		countRoles: jest.fn(),
	};
	const service = new IdentityService(repository as unknown as IdentityRepository);

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('API-IDN-01: returns counts from mocked repository', async () => {
		repository.countUsers.mockResolvedValue(3);
		repository.countGroups.mockResolvedValue(2);
		repository.countRoles.mockResolvedValue(1);

		await expect(service.countUsers()).resolves.toBe(3);
		await expect(service.countGroups()).resolves.toBe(2);
		await expect(service.countRoles()).resolves.toBe(1);
	});

	it('API-IDN-02: propagates repository errors', async () => {
		repository.countUsers.mockRejectedValue(new Error('db down'));
		await expect(service.countUsers()).rejects.toThrow('db down');
	});
});
