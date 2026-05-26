import { Controller, Get, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { HealthService } from './health.service';

@Controller()
export class HealthController {
	constructor(
		private readonly healthService: HealthService,
		private readonly configService: ConfigService,
	) {}

	@Get('health')
	getHealth() {
		return this.healthService.getHealth();
	}

	@Get('ready')
	async getReady(@Res() response: Response) {
		const databaseUrl = this.configService.get<string>('DATABASE_URL');
		const result = await this.healthService.getReady(databaseUrl);
		return response.status(result.httpStatus).json(result.body);
	}
}
