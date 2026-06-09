import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SYNC_SCHEDULE_DEFAULT_MIN_INTERVAL_MINUTES } from '@nestidp/shared';
import { boundedInt as boundedIntFromRaw } from '../../common/config/bounded-int.util';

export const DEFAULT_SYNC_SCHEDULER_TICK_MS = 30_000;
export const DEFAULT_SYNC_SCHEDULE_JITTER_MAX_SECONDS = 30;
export const DEFAULT_SYNC_SCHEDULE_FAILURE_AUTOPAUSE_THRESHOLD = 0;
export const DEFAULT_SYNC_SCHEDULE_BOOT_OVERDUE_GRACE_MINUTES = 0;

/**
 * Reads and bounds the scheduled-sync env knobs in one place so the scheduler and the admin API
 * (min-interval validation) always agree. Mirrors the `boundedInt` convention used by
 * {@link IdentitySyncClientService}.
 */
@Injectable()
export class SyncScheduleConfigService {
	constructor(private readonly configService: ConfigService) {}

	/** Tick interval (ms). `0` disables the in-process scheduler entirely. */
	getTickMs(): number {
		return this.boundedInt('SYNC_SCHEDULER_TICK_MS', DEFAULT_SYNC_SCHEDULER_TICK_MS, 0, 3_600_000);
	}

	/** True when the tick interval is enabled (> 0). */
	isSchedulerEnabled(): boolean {
		return this.getTickMs() > 0;
	}

	/** Minimum allowed cron frequency (minutes). */
	getMinIntervalMinutes(): number {
		return this.boundedInt(
			'SYNC_SCHEDULE_MIN_INTERVAL_MINUTES',
			SYNC_SCHEDULE_DEFAULT_MIN_INTERVAL_MINUTES,
			1,
			1440,
		);
	}

	/** Max random spread (seconds) added to a computed run; `0` = exact. */
	getJitterMaxSeconds(): number {
		return this.boundedInt(
			'SYNC_SCHEDULE_JITTER_MAX_SECONDS',
			DEFAULT_SYNC_SCHEDULE_JITTER_MAX_SECONDS,
			0,
			3600,
		);
	}

	/** N consecutive failed scheduled runs auto-pause the schedule; `0` = never. */
	getFailureAutopauseThreshold(): number {
		return this.boundedInt(
			'SYNC_SCHEDULE_FAILURE_AUTOPAUSE_THRESHOLD',
			DEFAULT_SYNC_SCHEDULE_FAILURE_AUTOPAUSE_THRESHOLD,
			0,
			1000,
		);
	}

	/** On boot, an overdue schedule runs immediately only if overdue by ≤ this many minutes (`0` = never). */
	getBootOverdueGraceMinutes(): number {
		return this.boundedInt(
			'SYNC_SCHEDULE_BOOT_OVERDUE_GRACE_MINUTES',
			DEFAULT_SYNC_SCHEDULE_BOOT_OVERDUE_GRACE_MINUTES,
			0,
			525_600,
		);
	}

	private boundedInt(key: string, fallback: number, min: number, max: number): number {
		// §6.1: delegate to the shared helper (adds correct empty-string handling).
		return boundedIntFromRaw(this.configService.get<number | string>(key), fallback, min, max);
	}
}
