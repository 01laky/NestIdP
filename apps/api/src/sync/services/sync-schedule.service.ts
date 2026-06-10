import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { ApiConnection, Prisma } from '@prisma/client';
import type {
	ScheduleResponseDto,
	SchedulesOverviewResponseDto,
	UpdateScheduleRequestDto,
} from '@nestidp/shared';
import {
	CronScheduleError,
	SYNC_SCHEDULE_DEFAULT_TIMEZONE,
	SYNC_SCHEDULE_PREVIEW_COUNT,
	validateCronSchedule,
} from '@nestidp/shared';
import { PrismaService } from '../../prisma/services/prisma.service';
import { AuditPersistenceService } from '../../audit/services/audit-persistence.service';
import { computeNextRunAt } from '../scheduler-time.util';
import { toApiConnectionScheduleDto, toSchedulesOverviewItemDto } from '../mappers/schedule.mapper';
import { SyncScheduleConfigService } from './sync-schedule-config.service';

@Injectable()
export class SyncScheduleService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly config: SyncScheduleConfigService,
		private readonly audit: AuditPersistenceService,
	) {}

	async getSchedule(connectionId: string): Promise<ScheduleResponseDto> {
		const connection = await this.findOrThrow(connectionId);
		return { schedule: toApiConnectionScheduleDto(connection, SYNC_SCHEDULE_PREVIEW_COUNT) };
	}

	async getOverview(): Promise<SchedulesOverviewResponseDto> {
		// §5.C: count each trigger source explicitly — the old `total - scheduled` arithmetic miscounted
		// 'manual_all' (sync-all) runs as manual. Legacy rows (null triggerSource) stay counted as manual.
		const [rows, scheduledRunCount, manualRunCount, manualAllRunCount] = await Promise.all([
			this.prisma.apiConnection.findMany({
				where: {
					isLocalDirectory: false,
					OR: [{ scheduleEnabled: true }, { scheduleCron: { not: null } }],
				},
				orderBy: { createdAt: 'asc' },
			}),
			this.prisma.syncLog.count({ where: { triggerSource: 'scheduled' } }),
			this.prisma.syncLog.count({
				where: { OR: [{ triggerSource: 'manual' }, { triggerSource: null }] },
			}),
			this.prisma.syncLog.count({ where: { triggerSource: 'manual_all' } }),
		]);
		return {
			schedulerEnabled: this.config.isSchedulerEnabled(),
			schedules: rows.map(toSchedulesOverviewItemDto),
			manualRunCount,
			scheduledRunCount,
			manualAllRunCount,
		};
	}

	async updateSchedule(
		connectionId: string,
		body: UpdateScheduleRequestDto,
		now: Date = new Date(),
	): Promise<ScheduleResponseDto> {
		const existing = await this.findOrThrow(connectionId);

		const enabled = body.scheduleEnabled ?? existing.scheduleEnabled;
		const paused = body.schedulePaused ?? existing.schedulePaused;
		const dryRun = body.scheduleDryRun ?? existing.scheduleDryRun;

		const cron = this.resolveCron(body, existing);
		const timezone = this.resolveTimezone(body, existing);

		// Validate cron/timezone whenever the schedule is (or becomes) enabled.
		if (enabled) {
			if (!cron) {
				throw new BadRequestException('A cron expression is required to enable the schedule');
			}
			try {
				validateCronSchedule(
					cron,
					timezone ?? SYNC_SCHEDULE_DEFAULT_TIMEZONE,
					this.config.getMinIntervalMinutes(),
				);
			} catch (error) {
				if (error instanceof CronScheduleError) {
					throw new BadRequestException(error.message);
				}
				throw error;
			}
		}

		const data: Prisma.ApiConnectionUpdateInput = {
			scheduleEnabled: enabled,
			schedulePaused: paused,
			scheduleDryRun: dryRun,
			scheduleCron: cron,
			scheduleTimezone: cron ? (timezone ?? SYNC_SCHEDULE_DEFAULT_TIMEZONE) : timezone,
		};

		data.nextRunAt = this.resolveNextRunAt({ existing, enabled, paused, cron, timezone, now });

		// Re-enabling or un-pausing (incl. lifting an auto-pause) clears the failure backoff state.
		const resuming =
			enabled &&
			!paused &&
			(existing.scheduleAutoPausedAt != null ||
				(body.schedulePaused === false && existing.schedulePaused) ||
				(body.scheduleEnabled === true && !existing.scheduleEnabled));
		if (resuming) {
			data.scheduleAutoPausedAt = null;
			data.scheduleConsecutiveFailures = 0;
			data.scheduleLastError = null;
		}

		const updated = await this.prisma.apiConnection.update({
			where: { id: existing.id },
			data,
		});

		this.recordScheduleUpdatedAudit(updated);
		return { schedule: toApiConnectionScheduleDto(updated, SYNC_SCHEDULE_PREVIEW_COUNT) };
	}

	/** Resolve the effective cron: explicit null clears, a string sets, omitted keeps existing. */
	private resolveCron(body: UpdateScheduleRequestDto, existing: ApiConnection): string | null {
		if (body.scheduleCron === undefined) {
			return existing.scheduleCron;
		}
		if (body.scheduleCron === null) {
			return null;
		}
		const trimmed = body.scheduleCron.trim();
		return trimmed.length > 0 ? trimmed : null;
	}

	private resolveTimezone(body: UpdateScheduleRequestDto, existing: ApiConnection): string | null {
		if (body.scheduleTimezone === undefined) {
			return existing.scheduleTimezone;
		}
		if (body.scheduleTimezone === null) {
			return null;
		}
		const trimmed = body.scheduleTimezone.trim();
		return trimmed.length > 0 ? trimmed : null;
	}

	/**
	 * Compute the pending `nextRunAt`:
	 * - disabled or no cron → null (cancels any pending run);
	 * - a cron/timezone change, a fresh enable, or a missing value → recompute cleanly (no double-fire);
	 * - otherwise keep the existing instant (pausing/dry-run toggles do not disturb the cadence).
	 */
	private resolveNextRunAt(input: {
		existing: ApiConnection;
		enabled: boolean;
		paused: boolean;
		cron: string | null;
		timezone: string | null;
		now: Date;
	}): Date | null {
		const { existing, enabled, cron, timezone, now } = input;
		if (!enabled || !cron) {
			return null;
		}
		const tz = timezone ?? SYNC_SCHEDULE_DEFAULT_TIMEZONE;
		const cronChanged = cron !== existing.scheduleCron;
		const tzChanged = tz !== (existing.scheduleTimezone ?? SYNC_SCHEDULE_DEFAULT_TIMEZONE);
		const becameEnabled = !existing.scheduleEnabled;
		if (cronChanged || tzChanged || becameEnabled || existing.nextRunAt == null) {
			return computeNextRunAt(cron, tz, now, this.config.getJitterMaxSeconds());
		}
		return existing.nextRunAt;
	}

	private recordScheduleUpdatedAudit(connection: ApiConnection): void {
		this.audit.recordSafe({
			category: 'admin_config',
			event: 'sync_schedule_updated',
			actorType: 'admin',
			subjectType: 'ApiConnection',
			subjectId: connection.id,
			metadata: {
				name: connection.name,
				scheduleEnabled: connection.scheduleEnabled,
				schedulePaused: connection.schedulePaused,
				scheduleDryRun: connection.scheduleDryRun,
				scheduleCron: connection.scheduleCron,
				scheduleTimezone: connection.scheduleTimezone,
			},
		});
	}

	private async findOrThrow(connectionId: string): Promise<ApiConnection> {
		const connection = await this.prisma.apiConnection.findUnique({ where: { id: connectionId } });
		if (!connection) {
			throw new NotFoundException('API connection not found');
		}
		if (connection.isLocalDirectory) {
			throw new ForbiddenException('Local directory connection cannot be scheduled');
		}
		return connection;
	}
}
