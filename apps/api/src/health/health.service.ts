import { Injectable } from '@nestjs/common';
import type { ReadyCheckResult } from '@nestidp/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
	constructor(private readonly prisma: PrismaService) {}

	getHealth() {
		return {
			status: 'ok' as const,
			service: 'nest-idp-api' as const,
		};
	}

	async getReady(databaseUrl: string | undefined): Promise<ReadyCheckResult> {
		if (!databaseUrl?.trim()) {
			return {
				httpStatus: 503,
				body: {
					status: 'unavailable',
					service: 'nest-idp-api',
					database: 'not_configured',
				},
			};
		}

		const connected = await this.prisma.pingDatabase();
		if (!connected) {
			return {
				httpStatus: 503,
				body: {
					status: 'unavailable',
					service: 'nest-idp-api',
					database: 'disconnected',
				},
			};
		}

		return {
			httpStatus: 200,
			body: {
				status: 'ok',
				service: 'nest-idp-api',
				database: 'connected',
			},
		};
	}
}
