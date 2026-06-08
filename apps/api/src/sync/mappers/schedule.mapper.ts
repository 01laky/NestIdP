import type { ApiConnection } from '@prisma/client';
import type { ApiConnectionScheduleDto, SchedulesOverviewItemDto } from '@nestidp/shared';
import { SYNC_SCHEDULE_DEFAULT_TIMEZONE, nextCronRuns } from '@nestidp/shared';

/**
 * Upcoming run instants (ISO) from a connection's cron+timezone, for the API/UI preview. Empty when
 * the schedule has no cron or the cron/timezone is invalid (never throws into the response).
 */
export function schedulePreviewRuns(connection: ApiConnection, count: number): string[] {
	if (!connection.scheduleCron) {
		return [];
	}
	const tz = connection.scheduleTimezone ?? SYNC_SCHEDULE_DEFAULT_TIMEZONE;
	try {
		return nextCronRuns(connection.scheduleCron, tz, count).map((d) => d.toISOString());
	} catch {
		return [];
	}
}

export function toApiConnectionScheduleDto(
	connection: ApiConnection,
	previewCount: number,
): ApiConnectionScheduleDto {
	return {
		connectionId: connection.id,
		scheduleEnabled: connection.scheduleEnabled,
		schedulePaused: connection.schedulePaused,
		scheduleDryRun: connection.scheduleDryRun,
		scheduleCron: connection.scheduleCron,
		scheduleTimezone: connection.scheduleTimezone,
		nextRunAt: connection.nextRunAt?.toISOString() ?? null,
		lastScheduledRunAt: connection.lastScheduledRunAt?.toISOString() ?? null,
		lastScheduledRunStatus: connection.lastScheduledRunStatus,
		scheduleLastError: connection.scheduleLastError,
		scheduleConsecutiveFailures: connection.scheduleConsecutiveFailures,
		scheduleAutoPausedAt: connection.scheduleAutoPausedAt?.toISOString() ?? null,
		nextRuns: schedulePreviewRuns(connection, previewCount),
	};
}

export function toSchedulesOverviewItemDto(connection: ApiConnection): SchedulesOverviewItemDto {
	return {
		connectionId: connection.id,
		connectionName: connection.name,
		scheduleEnabled: connection.scheduleEnabled,
		schedulePaused: connection.schedulePaused,
		scheduleDryRun: connection.scheduleDryRun,
		scheduleCron: connection.scheduleCron,
		scheduleTimezone: connection.scheduleTimezone,
		nextRunAt: connection.nextRunAt?.toISOString() ?? null,
		lastScheduledRunAt: connection.lastScheduledRunAt?.toISOString() ?? null,
		lastScheduledRunStatus: connection.lastScheduledRunStatus,
		scheduleConsecutiveFailures: connection.scheduleConsecutiveFailures,
		scheduleAutoPausedAt: connection.scheduleAutoPausedAt?.toISOString() ?? null,
		scheduleLastError: connection.scheduleLastError,
	};
}
