import { UnauthorizedException } from '@nestjs/common';
import { AdminAuthService } from '@api/admin-auth/services/admin-auth.service';
import { PasswordService } from '@api/admin-auth/services/password.service';

describe('AdminAuthService', () => {
	const prisma = {
		adminUser: {
			findUnique: jest.fn(),
		},
	};
	const passwordService = {
		verifyTimingSafe: jest.fn(),
	};
	const configService = {
		get: jest.fn(() => 'development'),
	};
	const audit = {
		logLoginSuccess: jest.fn(),
		logLoginFailure: jest.fn(),
	};
	const service = new AdminAuthService(
		prisma as never,
		passwordService as unknown as PasswordService,
		configService as never,
		audit as never,
	);
	const clientIp = '127.0.0.1';

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('API-AUT-01: login success with valid credentials', async () => {
		prisma.adminUser.findUnique.mockResolvedValue({
			id: 'a1',
			username: 'admin',
			passwordHash: 'hash',
		});
		passwordService.verifyTimingSafe.mockResolvedValue(true);

		await expect(service.login('admin', 'secret', clientIp)).resolves.toEqual({
			id: 'a1',
			username: 'admin',
		});
	});

	it('API-AUT-02: login fails unknown username → 401 generic message', async () => {
		prisma.adminUser.findUnique.mockResolvedValue(null);
		passwordService.verifyTimingSafe.mockResolvedValue(false);

		await expect(service.login('missing', 'secret', clientIp)).rejects.toThrow(
			UnauthorizedException,
		);
		await expect(service.login('missing', 'secret', clientIp)).rejects.toThrow(
			'Invalid credentials',
		);
	});

	it('API-AUT-03: login fails wrong password → 401 generic message', async () => {
		prisma.adminUser.findUnique.mockResolvedValue({
			id: 'a1',
			username: 'admin',
			passwordHash: 'hash',
		});
		passwordService.verifyTimingSafe.mockResolvedValue(false);

		await expect(service.login('admin', 'wrong', clientIp)).rejects.toThrow('Invalid credentials');
	});

	it('API-AUT-04: response never includes passwordHash', async () => {
		prisma.adminUser.findUnique.mockResolvedValue({
			id: 'a1',
			username: 'admin',
			passwordHash: 'hash',
		});
		passwordService.verifyTimingSafe.mockResolvedValue(true);

		const result = await service.login('admin', 'secret', clientIp);
		expect(result).not.toHaveProperty('passwordHash');
	});

	it('API-AUT-05: unknown username still invokes timing-safe verify', async () => {
		prisma.adminUser.findUnique.mockResolvedValue(null);
		passwordService.verifyTimingSafe.mockResolvedValue(false);

		await expect(service.login('ghost', 'secret', clientIp)).rejects.toThrow(UnauthorizedException);
		expect(passwordService.verifyTimingSafe).toHaveBeenCalledWith('secret', null);
	});

	it('API-AUT-06: resolveAuthenticatedAdmin returns admin dto', async () => {
		prisma.adminUser.findUnique.mockResolvedValue({
			id: 'a1',
			username: 'admin',
			passwordHash: 'hash',
		});

		await expect(service.resolveAuthenticatedAdmin('a1')).resolves.toEqual({
			id: 'a1',
			username: 'admin',
		});
	});

	it('API-AUT-07: resolveAuthenticatedAdmin throws when admin deleted', async () => {
		prisma.adminUser.findUnique.mockResolvedValue(null);
		await expect(service.resolveAuthenticatedAdmin('gone')).rejects.toThrow('Unauthorized');
	});
});
