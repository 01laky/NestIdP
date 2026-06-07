import { Injectable } from '@nestjs/common';
import type { ReadyCheckResult, ReadyExternalIdentityDb } from '@nestidp/shared';
import { PrismaService } from '../../prisma/services/prisma.service';

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

		const externalIdentityDb = await this.externalIdentityDbStatus();
		// In relocate mode the external DB is the authoritative identity store: if it is unreachable,
		// identity is degraded and readiness reflects that.
		const degraded =
			externalIdentityDb?.status === 'active' &&
			externalIdentityDb.mode === 'relocate' &&
			!externalIdentityDb.reachable;

		return {
			httpStatus: degraded ? 503 : 200,
			body: {
				status: degraded ? 'unavailable' : 'ok',
				service: 'nest-idp-api',
				database: 'connected',
				migrations: await this.prisma.appliedMigrationCount(),
				...(externalIdentityDb ? { externalIdentityDb } : {}),
			},
		};
	}

	private async externalIdentityDbStatus(): Promise<ReadyExternalIdentityDb | undefined> {
		try {
			const row = await this.prisma.externalIdentityDatabase.findUnique({
				where: { id: 'default' },
			});
			if (!row) {
				return undefined;
			}
			return {
				status: row.status,
				mode: row.mode,
				reachable: row.reachable,
				outOfSync: row.outOfSync,
			};
		} catch {
			return undefined;
		}
	}
}
