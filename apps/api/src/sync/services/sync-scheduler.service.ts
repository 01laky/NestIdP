import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SchedulerTickStats, SyncLogErrorEntryDto } from '@nestidp/shared';
import { CronScheduleError, SYNC_SCHEDULE_DEFAULT_TIMEZONE } from '@nestidp/shared';
import { parseBoolEnv } from '../../common/config/parse-bool-env.util';
import { errorMessage as messageOf } from '../../common/utils/error-message.util';
import { ApiConnection } from '@prisma/client';
import { PrismaService } from '../../prisma/services/prisma.service';
import { AuditPersistenceService } from '../../audit/services/audit-persistence.service';
import { computeNextRunAt, overdueMinutes } from '../scheduler-time.util';
import { SCHEDULED_SYNC_NOTIFIER, type ScheduledSyncNotifier } from '../scheduled-sync-notifier';
import { SyncScheduleConfigService } from './sync-schedule-config.service';
import { SyncService } from './sync.service';

/**
 * In-process scheduler for automatic identity syncs (Prompt 32).
 *
 * A single ticking timer (no `@nestjs/schedule`, following the
 * {@link AuditRetentionCleanupService} convention) reads fresh DB state each tick and triggers any
 * due connection through the existing {@link SyncService.triggerSync}. It persists `nextRunAt` so
 * schedules survive restarts, never double-runs (pre-checks the concurrency guard), does not catch up
 * missed slots, and isolates per-connection failures so one bad connection cannot stall the others.
 *
 * Single-instance only: NestIdP runs as one container. Multi-instance HA / leader election is out of
 * scope and would double-run.
 */
@Injectable()
export class SyncSchedulerService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(SyncSchedulerService.name);
	private intervalHandle: ReturnType<typeof setInterval> | null = null;
	private ticking = false;
	private lastTickAt: string | null = null;
	private lastProcessed: number | null = null;

	constructor(
		private readonly prisma: PrismaService,
		private readonly syncService: SyncService,
		private readonly config: SyncScheduleConfigService,
		private readonly audit: AuditPersistenceService,
		private readonly configService: ConfigService,
		@Inject(SCHEDULED_SYNC_NOTIFIER)
		private readonly notifier: ScheduledSyncNotifier,
	) {}

	async onModuleInit(): Promise<void> {
		if (this.isMigrateOnly()) {
			return;
		}
		const tickMs = this.config.getTickMs();
		if (tickMs <= 0) {
			this.logger.log(
				JSON.stringify({ event: 'sync_scheduler_disabled', reason: 'SYNC_SCHEDULER_TICK_MS=0' }),
			);
			return;
		}
		try {
			await this.reconcileOnBoot();
		} catch (error) {
			this.logger.warn(
				JSON.stringify({ event: 'sync_scheduler_boot_failed', message: messageOf(error) }),
			);
		}
		this.intervalHandle = setInterval(() => {
			void this.runTick();
		}, tickMs);
		this.logger.log(JSON.stringify({ event: 'sync_scheduler_started', tickMs }));
	}

	onModuleDestroy(): void {
		if (this.intervalHandle) {
			clearInterval(this.intervalHandle);
			this.intervalHandle = null;
		}
	}

	/**
	 * On boot, (re)compute `nextRunAt` for enabled, non-paused schedules whose value is missing or in
	 * the past. An overdue schedule runs immediately (left in the past so the next tick fires it) only
	 * if overdue by ≤ the boot grace; otherwise it advances to the next future occurrence WITHOUT
	 * running (no surprise sync after a deploy). Paused schedules are left entirely intact.
	 */
	async reconcileOnBoot(now: Date = new Date()): Promise<void> {
		const connections = await this.prisma.apiConnection.findMany({
			where: {
				scheduleEnabled: true,
				schedulePaused: false,
				isLocalDirectory: false,
				scheduleCron: { not: null },
			},
		});
		const graceMinutes = this.config.getBootOverdueGraceMinutes();
		for (const connection of connections) {
			try {
				if (connection.nextRunAt != null && connection.nextRunAt.getTime() > now.getTime()) {
					continue; // future run survives the restart untouched
				}
				if (
					connection.nextRunAt != null &&
					graceMinutes > 0 &&
					overdueMinutes(connection.nextRunAt, now) <= graceMinutes
				) {
					continue; // within grace — leave it overdue so the next tick runs it once
				}
				// Null (never computed) or overdue beyond grace → advance to the next future slot, no run.
				const next = this.computeNext(connection, now);
				await this.prisma.apiConnection.update({
					where: { id: connection.id },
					data: { nextRunAt: next, scheduleLastError: null },
				});
			} catch (error) {
				await this.recordCronError(connection, error);
			}
		}
	}

	/** Liveness gauge for /health: last completed tick + due connections it handled. */
	tickStats(): SchedulerTickStats {
		return { lastTickAt: this.lastTickAt, lastProcessed: this.lastProcessed };
	}

	/** One scheduler tick: trigger every due connection. Guarded against overlapping ticks. */
	async runTick(now: Date = new Date()): Promise<void> {
		if (this.ticking) {
			return;
		}
		this.ticking = true;
		try {
			const due = await this.prisma.apiConnection.findMany({
				where: {
					scheduleEnabled: true,
					schedulePaused: false,
					isLocalDirectory: false,
					scheduleCron: { not: null },
					nextRunAt: { lte: now },
				},
				orderBy: { nextRunAt: 'asc' },
			});
			this.lastProcessed = due.length;
			for (const connection of due) {
				try {
					await this.processDueConnection(connection, now);
				} catch (error) {
					// A single bad connection must not stall the scheduler.
					await this.recordCronError(connection, error);
				}
			}
		} finally {
			this.lastTickAt = new Date().toISOString();
			this.ticking = false;
		}
	}

	private async processDueConnection(connection: ApiConnection, now: Date): Promise<void> {
		// Pre-check the concurrency guard: a stale/hung open run is treated as reclaimable (not busy).
		if (await this.syncService.isSyncInProgress(connection.id)) {
			this.audit.recordSafe({
				category: 'sync',
				event: 'sync_scheduled_run_skipped',
				actorType: 'system',
				subjectType: 'ApiConnection',
				subjectId: connection.id,
				metadata: { name: connection.name, reason: 'sync_in_progress' },
			});
			return; // leave nextRunAt intact so it retries next tick
		}

		// Advance the schedule BEFORE triggering so a long run cannot re-fire the same slot, and a
		// failed trigger waits for the next slot instead of hammering the external API (no catch-up).
		const next = this.computeNext(connection, now);
		await this.prisma.apiConnection.update({
			where: { id: connection.id },
			data: { nextRunAt: next, lastScheduledRunAt: now },
		});
		this.audit.recordSafe({
			category: 'sync',
			event: 'sync_scheduled_run_started',
			actorType: 'system',
			subjectType: 'ApiConnection',
			subjectId: connection.id,
			metadata: { name: connection.name, dryRun: connection.scheduleDryRun },
		});

		let status: 'SUCCESS' | 'FAILED';
		let syncLogId: string | undefined;
		try {
			const result = await this.syncService.triggerSync(connection.id, {
				triggerSource: 'scheduled',
				dryRun: connection.scheduleDryRun,
			});
			status = result.syncLog.status === 'FAILED' ? 'FAILED' : 'SUCCESS';
			syncLogId = result.syncLog.id;
			if (status === 'FAILED') {
				await this.handleScheduledFailure(
					connection,
					now,
					summarizeSyncErrors(result.syncLog.errors),
					syncLogId,
				);
				return;
			}
			// SUCCESS: triggerSync already cleared the failure/auto-pause state; record the scheduled result.
			await this.prisma.apiConnection.update({
				where: { id: connection.id },
				data: { lastScheduledRunStatus: 'SUCCESS' },
			});
		} catch (error) {
			await this.handleScheduledFailure(connection, now, messageOf(error), syncLogId);
		}
	}

	/** Increment the consecutive-failure counter, record the error, and auto-pause at the threshold. */
	private async handleScheduledFailure(
		connection: ApiConnection,
		now: Date,
		message: string,
		syncLogId: string | undefined,
	): Promise<void> {
		const fresh = await this.prisma.apiConnection.findUnique({ where: { id: connection.id } });
		const failures = (fresh?.scheduleConsecutiveFailures ?? 0) + 1;
		const threshold = this.config.getFailureAutopauseThreshold();
		const autoPause = threshold > 0 && failures >= threshold;
		await this.prisma.apiConnection.update({
			where: { id: connection.id },
			data: {
				scheduleConsecutiveFailures: failures,
				scheduleLastError: message,
				lastScheduledRunStatus: 'FAILED',
				...(autoPause ? { schedulePaused: true, scheduleAutoPausedAt: now } : {}),
			},
		});
		// Distinct, queryable failure event (separate from the per-run sync_failed audit).
		this.audit.recordSafe({
			category: 'sync',
			event: 'sync_scheduled_run_failed',
			actorType: 'system',
			subjectType: 'ApiConnection',
			subjectId: connection.id,
			metadata: {
				name: connection.name,
				consecutiveFailures: failures,
				syncLogId: syncLogId ?? null,
			},
		});
		if (autoPause) {
			this.audit.recordSafe({
				category: 'sync',
				event: 'sync_schedule_auto_paused',
				actorType: 'system',
				subjectType: 'ApiConnection',
				subjectId: connection.id,
				metadata: { name: connection.name, consecutiveFailures: failures, threshold },
			});
		}
		this.notifier.notifyFailure({
			connectionId: connection.id,
			connectionName: connection.name,
			consecutiveFailures: failures,
			autoPaused: autoPause,
			message,
			syncLogId,
		});
	}

	/** Next run instant from the connection's cron + timezone, with jitter. Throws on invalid cron. */
	private computeNext(connection: ApiConnection, after: Date): Date {
		const cron = connection.scheduleCron ?? '';
		const tz = connection.scheduleTimezone ?? SYNC_SCHEDULE_DEFAULT_TIMEZONE;
		return computeNextRunAt(cron, tz, after, this.config.getJitterMaxSeconds());
	}

	/**
	 * Record an invalid cron/timezone: clear `nextRunAt` (so it stops being perpetually "due") and store
	 * the error. The schedule stays enabled; fixing the cron via the API recomputes `nextRunAt`.
	 */
	private async recordCronError(connection: ApiConnection, error: unknown): Promise<void> {
		const message = messageOf(error);
		this.logger.warn(
			JSON.stringify({
				event: 'sync_scheduler_connection_error',
				connectionId: connection.id,
				message,
			}),
		);
		const data: { scheduleLastError: string; nextRunAt?: null } = { scheduleLastError: message };
		if (error instanceof CronScheduleError) {
			data.nextRunAt = null;
		}
		try {
			await this.prisma.apiConnection.update({ where: { id: connection.id }, data });
		} catch {
			// Connection may have been deleted mid-tick — nothing to record, ignore.
		}
	}

	private isMigrateOnly(): boolean {
		// §6.1: shared truthy-env parsing.
		return parseBoolEnv(this.configService.get<string>('MIGRATE_ONLY'));
	}
}

/** Build a short human message from a sync log's structured errors for `scheduleLastError`. */
function summarizeSyncErrors(errors: SyncLogErrorEntryDto[] | null): string {
	if (!errors || errors.length === 0) {
		return 'Scheduled sync failed';
	}
	const first = errors[0];
	const detail = first.message ?? first.phase;
	return errors.length > 1 ? `${detail} (+${errors.length - 1} more)` : detail;
}
