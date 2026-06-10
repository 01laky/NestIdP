import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
	HealthResponse,
	ReadyCheckResult,
	ReadyExternalIdentityDb,
	ReadyMigrations,
	ReadyScheduler,
} from '@nestidp/shared';
import { AuditPersistenceService } from '../../audit/services/audit-persistence.service';
import { CertRotationSchedulerService } from '../../idp-settings/services/cert-rotation-scheduler.service';
import { countMigrationDirs } from '../../prisma/db-migrator';
import { PrismaService } from '../../prisma/services/prisma.service';
import { BackchannelLogoutSchedulerService } from '../../saml/services/backchannel-logout-scheduler.service';
import { SyncSchedulerService } from '../../sync/services/sync-scheduler.service';

@Injectable()
export class HealthService {
	// Resolved once: the version cannot change while the process is up.
	private cachedVersion: string | null | undefined;

	constructor(
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
		private readonly auditPersistence: AuditPersistenceService,
		private readonly syncScheduler: SyncSchedulerService,
		private readonly certRotationScheduler: CertRotationSchedulerService,
		private readonly backchannelScheduler: BackchannelLogoutSchedulerService,
	) {}

	getHealth(): HealthResponse {
		const persistFailures = this.auditPersistence.persistFailureStats();
		return {
			status: 'ok' as const,
			service: 'nest-idp-api' as const,
			version: this.resolveVersion(),
			gitSha: this.configService.get<string>('BUILD_GIT_SHA') || null,
			uptimeSeconds: Math.floor(process.uptime()),
			audit: {
				persistFailures: persistFailures.count,
				lastPersistFailureAt: persistFailures.lastAt,
			},
			schedulers: {
				backchannel: this.backchannelScheduler.tickStats(),
				sync: this.syncScheduler.tickStats(),
				certRotation: this.certRotationScheduler.tickStats(),
			},
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
				migrations: await this.migrationsStatus(),
				...(externalIdentityDb ? { externalIdentityDb } : {}),
				...(scheduler ? { scheduler } : {}),
			},
		};
	}

	/** Applied (tracking table) vs available (migration dirs on disk — no SQL is read or validated). */
	private async migrationsStatus(): Promise<ReadyMigrations> {
		const applied = await this.prisma.appliedMigrationCount();
		let available = 0;
		try {
			available = countMigrationDirs();
		} catch {
			available = 0; // unreadable migrations dir must not break readiness
		}
		return { applied, available, upToDate: applied >= available };
	}

	private resolveVersion(): string | null {
		if (this.cachedVersion === undefined) {
			this.cachedVersion =
				this.configService.get<string>('npm_package_version') || readPackageJsonVersion();
		}
		return this.cachedVersion;
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

/** Fallback when npm_package_version is absent (production `node dist/main.js`): the api package.json. */
function readPackageJsonVersion(): string | null {
	try {
		const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8');
		const parsed = JSON.parse(raw) as { version?: unknown };
		return typeof parsed.version === 'string' && parsed.version ? parsed.version : null;
	} catch {
		return null;
	}
}
