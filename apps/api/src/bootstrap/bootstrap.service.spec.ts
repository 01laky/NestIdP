import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BootstrapService } from './bootstrap.service';

describe('BootstrapService', () => {
	let logSpy: jest.SpyInstance;
	let warnSpy: jest.SpyInstance;

	beforeEach(() => {
		logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
		warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('logs placeholder message when admin env vars are set', () => {
		const config = {
			get: jest.fn((key: string) => {
				if (key === 'ADMIN_USERNAME') return 'admin';
				if (key === 'ADMIN_PASSWORD') return 'secret';
				return undefined;
			}),
		} as unknown as ConfigService;

		const service = new BootstrapService(config);
		service.onModuleInit();

		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('TODO'));
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it('warns when admin env vars are missing', () => {
		const config = {
			get: jest.fn(() => undefined),
		} as unknown as ConfigService;

		const service = new BootstrapService(config);
		service.onModuleInit();

		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not set'));
	});

	it('warns when only ADMIN_USERNAME is set', () => {
		const config = {
			get: jest.fn((key: string) => (key === 'ADMIN_USERNAME' ? 'admin' : undefined)),
		} as unknown as ConfigService;

		const service = new BootstrapService(config);
		service.onModuleInit();

		expect(warnSpy).toHaveBeenCalled();
		expect(logSpy).not.toHaveBeenCalled();
	});

	it('warns when only ADMIN_PASSWORD is set', () => {
		const config = {
			get: jest.fn((key: string) => (key === 'ADMIN_PASSWORD' ? 'secret' : undefined)),
		} as unknown as ConfigService;

		const service = new BootstrapService(config);
		service.onModuleInit();

		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not set'));
		expect(logSpy).not.toHaveBeenCalled();
	});

	it('warns when ADMIN_USERNAME is empty string', () => {
		const config = {
			get: jest.fn((key: string) => {
				if (key === 'ADMIN_USERNAME') return '';
				if (key === 'ADMIN_PASSWORD') return 'secret';
				return undefined;
			}),
		} as unknown as ConfigService;

		const service = new BootstrapService(config);
		service.onModuleInit();

		expect(warnSpy).toHaveBeenCalled();
	});
});
