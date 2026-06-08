import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ReadyCheckResult, ReadyExternalIdentityDb, ReadyScheduler } from '@nestidp/shared';
import { PrismaService } from '../../prisma/services/prisma.service';

@Injectable()
export class HealthService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
	) {}

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
		const scheduler = await this.schedulerStatus();
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
				...(scheduler ? { scheduler } : {}),
			},
		};
	}

	/** Scheduled-sync liveness (Prompt 32): tick enabled + how many connections are scheduled / due. */
	private async schedulerStatus(): Promise<ReadyScheduler | undefined> {
		try {
			const now = new Date();
			const [scheduledConnections, due] = await Promise.all([
				this.prisma.apiConnection.count({
					where: { scheduleEnabled: true, isLocalDirectory: false },
				}),
				this.prisma.apiConnection.count({
					where: {
						scheduleEnabled: true,
						schedulePaused: false,
						isLocalDirectory: false,
						nextRunAt: { lte: now },
					},
				}),
			]);
			return { enabled: this.isSchedulerTickEnabled(), scheduledConnections, due };
		} catch {
			return undefined;
		}
	}

	private isSchedulerTickEnabled(): boolean {
		const raw = this.configService.get<number | string>('SYNC_SCHEDULER_TICK_MS');
		if (raw === undefined || raw === null || raw === '') {
			return true; // default tick is 30000 (enabled)
		}
		const parsed = Number(raw);
		return Number.isFinite(parsed) ? parsed > 0 : true;
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
