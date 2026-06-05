import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { HealthController } from '@api/health/controllers/health.controller';
import { HealthService } from '@api/health/services/health.service';

describe('HealthController', () => {
	const healthService = {
		getHealth: jest.fn(),
		getReady: jest.fn(),
	};
	const configService = {
		get: jest.fn(),
	};
	const controller = new HealthController(
		healthService as unknown as HealthService,
		configService as unknown as ConfigService,
	);

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('getHealth returns service payload without config lookup', () => {
		healthService.getHealth.mockReturnValue({ status: 'ok', service: 'nest-idp-api' });
		expect(controller.getHealth()).toEqual({ status: 'ok', service: 'nest-idp-api' });
		expect(configService.get).not.toHaveBeenCalled();
	});

	it('getReady sets 200 when service reports connected database', async () => {
		configService.get.mockReturnValue('postgresql://localhost:5432/nestidp');
		healthService.getReady.mockResolvedValue({
			httpStatus: 200,
			body: { status: 'ok', service: 'nest-idp-api', database: 'connected' },
		});
		const json = jest.fn();
		const status = jest.fn().mockReturnValue({ json });
		await controller.getReady({ status } as unknown as Response);
		expect(healthService.getReady).toHaveBeenCalledWith('postgresql://localhost:5432/nestidp');
		expect(status).toHaveBeenCalledWith(200);
		expect(json).toHaveBeenCalledWith({
			status: 'ok',
			service: 'nest-idp-api',
			database: 'connected',
		});
	});

	it('getReady sets 503 when service reports unavailable database', async () => {
		configService.get.mockReturnValue(undefined);
		healthService.getReady.mockResolvedValue({
			httpStatus: 503,
			body: { status: 'unavailable', service: 'nest-idp-api', database: 'not_configured' },
		});
		const json = jest.fn();
		const status = jest.fn().mockReturnValue({ json });
		await controller.getReady({ status } as unknown as Response);
		expect(status).toHaveBeenCalledWith(503);
		expect(json).toHaveBeenCalledWith({
			status: 'unavailable',
			service: 'nest-idp-api',
			database: 'not_configured',
		});
	});
});
