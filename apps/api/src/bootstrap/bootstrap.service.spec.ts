import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BootstrapService } from './bootstrap.service';
import { runBootstrap } from './run-bootstrap';

jest.mock('./run-bootstrap', () => ({
	runBootstrap: jest.fn().mockResolvedValue({ adminCreated: true, idpSettingsCreated: true }),
}));

describe('BootstrapService', () => {
	let logSpy: jest.SpyInstance;
	let errorSpy: jest.SpyInstance;
	const prisma = {} as never;

	beforeEach(() => {
		jest.clearAllMocks();
		logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
		errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
		jest.spyOn(Logger.prototype, 'warn').mockImplementation();
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('delegates to runBootstrap with env config', async () => {
		const config = {
			get: jest.fn((key: string) => {
				if (key === 'ADMIN_USERNAME') return 'admin';
				if (key === 'ADMIN_PASSWORD') return 'strong-password-123';
				if (key === 'IDP_BASE_URL') return 'https://idp.example.com';
				if (key === 'NODE_ENV') return 'development';
				return undefined;
			}),
		} as unknown as ConfigService;

		const service = new BootstrapService(config, prisma);
		await service.onModuleInit();

		expect(runBootstrap).toHaveBeenCalledWith(
			prisma,
			expect.objectContaining({
				adminUsername: 'admin',
				adminPassword: 'strong-password-123',
				idpBaseUrl: 'https://idp.example.com',
			}),
			expect.any(Object),
		);
		expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('TODO'));
	});

	it('rethrows bootstrap failures', async () => {
		jest.mocked(runBootstrap).mockRejectedValueOnce(new Error('bootstrap failed'));
		const config = {
			get: jest.fn((key: string) => {
				if (key === 'IDP_BASE_URL') return 'https://idp.example.com';
				return undefined;
			}),
		} as unknown as ConfigService;

		const service = new BootstrapService(config, prisma);
		await expect(service.onModuleInit()).rejects.toThrow('bootstrap failed');
		expect(errorSpy).toHaveBeenCalled();
	});

	it('API-BST-SVC-01: passes NODE_ENV to runBootstrap', async () => {
		const config = {
			get: jest.fn((key: string) => {
				if (key === 'IDP_BASE_URL') return 'https://idp.example.com';
				if (key === 'NODE_ENV') return 'production';
				return undefined;
			}),
		} as unknown as ConfigService;

		const service = new BootstrapService(config, prisma);
		await service.onModuleInit();

		expect(runBootstrap).toHaveBeenCalledWith(
			prisma,
			expect.objectContaining({ nodeEnv: 'production' }),
			expect.any(Object),
		);
	});
});
