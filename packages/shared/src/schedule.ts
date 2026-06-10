import * as cronParser from 'cron-parser';
import type { LastSyncStatus } from './schema-enums.js';
import { SYNC_API_PATH } from './sync.js';

/** How many upcoming runs the schedule API/UI preview shows. */
export const SYNC_SCHEDULE_PREVIEW_COUNT = 5;

/** REST path for a single connection's schedule (GET/PATCH). */
export function syncSchedulePath(connectionId: string): string {
	return `${SYNC_API_PATH}/${connectionId}/schedule`;
}

/** REST path for the cross-connection schedules overview (GET). */
export function syncSchedulesOverviewPath(): string {
	return `${SYNC_API_PATH}/schedules/overview`;
}

/**
 * Shared cron-schedule helpers backed by `cron-parser` (pure JS, IANA-timezone + DST aware).
 *
 * Used by both the API (validation + scheduler next-run computation) and the admin UI (live preview),
 * so API and UI always agree on what a cron expression means and when it fires.
 */

/** Default IANA timezone applied when an operator does not pick one. */
export const SYNC_SCHEDULE_DEFAULT_TIMEZONE = 'UTC';

/**
 * Default minimum allowed cron frequency (minutes). A schedule that would fire more often than this is
 * rejected so an operator cannot accidentally hammer the external API. Overridable per call (the API
 * passes `SYNC_SCHEDULE_MIN_INTERVAL_MINUTES`).
 */
export const SYNC_SCHEDULE_DEFAULT_MIN_INTERVAL_MINUTES = 5;

/** How many consecutive runs we sample to derive a schedule's smallest gap (for the min-interval guard). */
const MIN_INTERVAL_SAMPLE_COUNT = 50;

/** Thrown by the shared validators; the API maps it to a 400 with the message. */
export class CronScheduleError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CronScheduleError';
	}
}

/** A named cron preset offered in the UI; `labelKey` is an i18n key (UI translates it). */
export interface CronPreset {
	id: string;
	cron: string;
	labelKey: string;
}

/**
 * The named presets the UI offers and the API accepts. Keep these in sync with the i18n
 * `schedule.preset.*` keys in every locale. All are at/above the default 5-minute min interval.
 */
export const SYNC_SCHEDULE_PRESETS: readonly CronPreset[] = [
	{ id: 'every_15_min', cron: '*/15 * * * *', labelKey: 'schedule.preset.every15min' },
	{ id: 'every_30_min', cron: '*/30 * * * *', labelKey: 'schedule.preset.every30min' },
	{ id: 'hourly', cron: '0 * * * *', labelKey: 'schedule.preset.hourly' },
	{ id: 'every_6_hours', cron: '0 */6 * * *', labelKey: 'schedule.preset.every6h' },
	{ id: 'daily_2am', cron: '0 2 * * *', labelKey: 'schedule.preset.daily2am' },
	{ id: 'weekdays_6am', cron: '0 6 * * 1-5', labelKey: 'schedule.preset.weekdays6am' },
	{ id: 'weekly_sun_3am', cron: '0 3 * * 0', labelKey: 'schedule.preset.weeklySun3am' },
] as const;

/** True when `tz` is a timezone the runtime's Intl database recognises. */
export function isValidTimezone(tz: string | null | undefined): boolean {
	if (!tz || typeof tz !== 'string' || tz.trim().length === 0) {
		return false;
	}
	try {
		// Throws RangeError for an unknown IANA zone.
		new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() });
		return true;
	} catch {
		return false;
	}
}

/**
 * Build the next occurrences strictly after `after` for `cron` in `timezone`.
 * Throws {@link CronScheduleError} for a malformed cron or an unknown timezone.
 */
export function nextCronRuns(
	cron: string,
	timezone: string,
	count: number,
	after: Date = new Date(),
): Date[] {
	if (count <= 0) {
		return [];
	}
	const tz = (timezone ?? '').trim() || SYNC_SCHEDULE_DEFAULT_TIMEZONE;
	if (!isValidTimezone(tz)) {
		throw new CronScheduleError(`Unknown timezone: ${timezone}`);
	}
	let interval: cronParser.CronExpression;
	try {
		interval = cronParser.CronExpressionParser.parse((cron ?? '').trim(), {
			tz,
			currentDate: after,
		});
	} catch (error) {
		throw new CronScheduleError(
			`Invalid cron expression: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const runs: Date[] = [];
	try {
		for (let i = 0; i < count; i += 1) {
			runs.push(interval.next().toDate());
		}
	} catch (error) {
		// cron-parser surfaces unknown timezones lazily on iteration.
		throw new CronScheduleError(
			`Invalid cron expression or timezone: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	return runs;
}

/**
 * The single next occurrence strictly after `after` (default now) — used by the scheduler to advance
 * `nextRunAt` past the current instant without replaying missed slots ("no catch-up").
 */
export function nextCronRun(cron: string, timezone: string, after: Date = new Date()): Date {
	return nextCronRuns(cron, timezone, 1, after)[0];
}

/**
 * The smallest gap (in minutes) between consecutive runs of `cron` in `timezone`, sampled over the
 * next {@link MIN_INTERVAL_SAMPLE_COUNT} occurrences. Used by the min-interval guard.
 */
export function smallestCronIntervalMinutes(cron: string, timezone: string): number {
	const runs = nextCronRuns(cron, timezone, MIN_INTERVAL_SAMPLE_COUNT + 1);
	let smallestMs = Number.POSITIVE_INFINITY;
	for (let i = 1; i < runs.length; i += 1) {
		const gap = runs[i].getTime() - runs[i - 1].getTime();
		if (gap > 0 && gap < smallestMs) {
			smallestMs = gap;
		}
	}
	if (!Number.isFinite(smallestMs)) {
		return Number.POSITIVE_INFINITY;
	}
	return smallestMs / 60_000;
}

/**
 * Validate a cron expression + timezone for use as a sync schedule.
 * Rejects: empty/malformed cron, unknown timezone, and schedules that fire more often than
 * `minIntervalMinutes` (default {@link SYNC_SCHEDULE_DEFAULT_MIN_INTERVAL_MINUTES}).
 * Throws {@link CronScheduleError} on any violation; returns normally when valid.
 */
export function validateCronSchedule(
	cron: string,
	timezone: string,
	minIntervalMinutes: number = SYNC_SCHEDULE_DEFAULT_MIN_INTERVAL_MINUTES,
): void {
	if (!cron || typeof cron !== 'string' || cron.trim().length === 0) {
		throw new CronScheduleError('Cron expression is required');
	}
	const tz = (timezone ?? '').trim() || SYNC_SCHEDULE_DEFAULT_TIMEZONE;
	if (!isValidTimezone(tz)) {
		throw new CronScheduleError(`Unknown timezone: ${timezone}`);
	}
	// nextCronRuns throws CronScheduleError for malformed cron / lazily-detected tz issues.
	const smallest = smallestCronIntervalMinutes(cron, tz);
	if (smallest + 1e-9 < minIntervalMinutes) {
		throw new CronScheduleError(
			`Schedule fires too frequently (every ~${Math.round(
				smallest,
			)} min); the minimum interval is ${minIntervalMinutes} minutes`,
		);
	}
}

// --- DTOs shared by the schedule API + admin UI ---

/** Full schedule state for one API connection (never includes secrets). */
export interface ApiConnectionScheduleDto {
	connectionId: string;
	scheduleEnabled: boolean;
	schedulePaused: boolean;
	scheduleDryRun: boolean;
	scheduleCron: string | null;
	scheduleTimezone: string | null;
	nextRunAt: string | null;
	lastScheduledRunAt: string | null;
	lastScheduledRunStatus: LastSyncStatus | null;
	scheduleLastError: string | null;
	scheduleConsecutiveFailures: number;
	scheduleAutoPausedAt: string | null;
	/** Preview of the upcoming runs (ISO instants), computed from cron+timezone; empty when disabled. */
	nextRuns: string[];
}

/** PATCH body for the schedule endpoint. Omitted fields are unchanged; explicit null clears the cron. */
export interface UpdateScheduleRequestDto {
	scheduleEnabled?: boolean;
	scheduleCron?: string | null;
	scheduleTimezone?: string | null;
	schedulePaused?: boolean;
	scheduleDryRun?: boolean;
}

export interface ScheduleResponseDto {
	schedule: ApiConnectionScheduleDto;
}

/** One row in the cross-connection schedules overview. */
export interface SchedulesOverviewItemDto {
	connectionId: string;
	connectionName: string;
	scheduleEnabled: boolean;
	schedulePaused: boolean;
	scheduleDryRun: boolean;
	scheduleCron: string | null;
	scheduleTimezone: string | null;
	nextRunAt: string | null;
	lastScheduledRunAt: string | null;
	lastScheduledRunStatus: LastSyncStatus | null;
	scheduleConsecutiveFailures: number;
	scheduleAutoPausedAt: string | null;
	scheduleLastError: string | null;
}

export interface SchedulesOverviewResponseDto {
	/** True when the in-process scheduler tick is enabled (SYNC_SCHEDULER_TICK_MS > 0). */
	schedulerEnabled: boolean;
	schedules: SchedulesOverviewItemDto[];
	/** Runs started by a single-connection manual trigger (legacy null rows counted as manual). */
	manualRunCount: number;
	scheduledRunCount: number;
	/** Runs launched per-connection by the "sync all sources" bulk trigger (§5.C; additive). */
	manualAllRunCount: number;
}
