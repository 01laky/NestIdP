import { describe, expect, it } from 'vitest';
import {
	CronScheduleError,
	SYNC_SCHEDULE_DEFAULT_MIN_INTERVAL_MINUTES,
	SYNC_SCHEDULE_DEFAULT_TIMEZONE,
	SYNC_SCHEDULE_PRESETS,
	isValidTimezone,
	nextCronRun,
	nextCronRuns,
	smallestCronIntervalMinutes,
	validateCronSchedule,
} from '@shared/schedule.js';

describe('schedule cron helpers (shared)', () => {
	it('CRON-01: valid expression accepted; next-run preview correct for a timezone', () => {
		// 02:00 in Bratislava (CET, UTC+1) on 2026-06-09 = 00:00Z (CEST, UTC+2 in summer).
		const runs = nextCronRuns(
			'0 2 * * *',
			'Europe/Bratislava',
			1,
			new Date('2026-06-08T12:00:00Z'),
		);
		expect(runs).toHaveLength(1);
		expect(runs[0].toISOString()).toBe('2026-06-09T00:00:00.000Z');
		expect(() => validateCronSchedule('0 2 * * *', 'Europe/Bratislava')).not.toThrow();
	});

	it('CRON-02: malformed cron rejected; unknown timezone rejected', () => {
		expect(() => validateCronSchedule('not a cron', 'UTC')).toThrow(CronScheduleError);
		expect(() => validateCronSchedule('0 2 * * *', 'Mars/Phobos')).toThrow(/Unknown timezone/);
		expect(isValidTimezone('Mars/Phobos')).toBe(false);
		expect(isValidTimezone('Europe/Bratislava')).toBe(true);
	});

	it('CRON-03: below-min-interval rejected; at/above min accepted', () => {
		expect(() => validateCronSchedule('* * * * *', 'UTC')).toThrow(/too frequently/);
		// every 2 minutes < default 5 → rejected
		expect(() => validateCronSchedule('*/2 * * * *', 'UTC')).toThrow(CronScheduleError);
		// exactly 5 minutes → accepted
		expect(() => validateCronSchedule('*/5 * * * *', 'UTC')).not.toThrow();
		expect(() => validateCronSchedule('*/15 * * * *', 'UTC')).not.toThrow();
		// custom override: with min 1, every-minute is allowed
		expect(() => validateCronSchedule('* * * * *', 'UTC', 1)).not.toThrow();
	});

	it('CRON-04: nextCronRuns returns the requested count, ascending, all in the future', () => {
		const after = new Date('2026-06-08T10:07:00Z');
		const runs = nextCronRuns('*/15 * * * *', 'UTC', 4, after);
		expect(runs).toHaveLength(4);
		for (let i = 0; i < runs.length; i += 1) {
			expect(runs[i].getTime()).toBeGreaterThan(after.getTime());
			if (i > 0) {
				expect(runs[i].getTime()).toBeGreaterThan(runs[i - 1].getTime());
			}
		}
		expect(runs[0].toISOString()).toBe('2026-06-08T10:15:00.000Z');
	});

	it('CRON-05: timezone/DST — a daily schedule crosses a DST boundary correctly', () => {
		// Europe/Bratislava springs forward 2026-03-29 (02:00 -> 03:00).
		// 02:00 local is 01:00Z before the change (CET) and 00:00Z after (CEST).
		const runs = nextCronRuns(
			'0 2 * * *',
			'Europe/Bratislava',
			3,
			new Date('2026-03-27T12:00:00Z'),
		);
		expect(runs.map((d) => d.toISOString())).toEqual([
			'2026-03-28T01:00:00.000Z',
			'2026-03-29T01:00:00.000Z',
			'2026-03-30T00:00:00.000Z',
		]);
	});

	it('CRON-06: nextCronRun returns the single next occurrence strictly after the instant', () => {
		const at = new Date('2026-06-08T10:15:00Z');
		// exactly on a slot → returns the *next* one (strictly after)
		const next = nextCronRun('*/15 * * * *', 'UTC', at);
		expect(next.toISOString()).toBe('2026-06-08T10:30:00.000Z');
	});

	it('CRON-07: smallestCronIntervalMinutes reflects the cadence', () => {
		expect(smallestCronIntervalMinutes('*/15 * * * *', 'UTC')).toBe(15);
		expect(smallestCronIntervalMinutes('0 * * * *', 'UTC')).toBe(60);
		// weekdays 6am: smallest gap is 1 day (Tue→Wed), never below a day
		expect(smallestCronIntervalMinutes('0 6 * * 1-5', 'UTC')).toBeGreaterThanOrEqual(1440);
	});

	it('CRON-08: all named presets are valid and at/above the default min interval', () => {
		expect(SYNC_SCHEDULE_PRESETS.length).toBeGreaterThan(0);
		for (const preset of SYNC_SCHEDULE_PRESETS) {
			expect(() => validateCronSchedule(preset.cron, SYNC_SCHEDULE_DEFAULT_TIMEZONE)).not.toThrow();
			expect(
				smallestCronIntervalMinutes(preset.cron, SYNC_SCHEDULE_DEFAULT_TIMEZONE),
			).toBeGreaterThanOrEqual(SYNC_SCHEDULE_DEFAULT_MIN_INTERVAL_MINUTES);
			expect(preset.labelKey.startsWith('schedule.preset.')).toBe(true);
		}
	});

	it('CRON-09: empty/whitespace cron and empty timezone handled', () => {
		expect(() => validateCronSchedule('', 'UTC')).toThrow(/required/);
		expect(() => validateCronSchedule('   ', 'UTC')).toThrow(/required/);
		// empty timezone falls back to the default UTC
		const runs = nextCronRuns('0 0 * * *', '', 1, new Date('2026-06-08T12:00:00Z'));
		expect(runs[0].toISOString()).toBe('2026-06-09T00:00:00.000Z');
	});
});

describe('schedule cron helpers — extended edge cases', () => {
	it('CRON-10: a sub-minute 6-field cron (seconds) is rejected by the min-interval guard', () => {
		// cron-parser accepts 6 fields (seconds-first); every 10s is far below the 5-minute minimum.
		expect(() => validateCronSchedule('*/10 * * * * *', 'UTC')).toThrow(/too frequently/);
		// A 6-field daily expression is fine.
		expect(() => validateCronSchedule('0 0 2 * * *', 'UTC')).not.toThrow();
		expect(
			nextCronRuns('0 0 2 * * *', 'UTC', 1, new Date('2026-06-08T12:00:00Z'))[0].toISOString(),
		).toBe('2026-06-09T02:00:00.000Z');
	});

	it('CRON-11: cron macros (@daily, @hourly) are supported', () => {
		expect(
			nextCronRuns('@daily', 'UTC', 1, new Date('2026-06-08T12:00:00Z'))[0].toISOString(),
		).toBe('2026-06-09T00:00:00.000Z');
		expect(
			nextCronRuns('@hourly', 'UTC', 1, new Date('2026-06-08T12:07:00Z'))[0].toISOString(),
		).toBe('2026-06-08T13:00:00.000Z');
		expect(smallestCronIntervalMinutes('@hourly', 'UTC')).toBe(60);
	});

	it('CRON-12: named weekday ranges (MON-FRI) are accepted', () => {
		expect(() => validateCronSchedule('0 6 * * MON-FRI', 'UTC')).not.toThrow();
		expect(smallestCronIntervalMinutes('0 6 * * MON-FRI', 'UTC')).toBeGreaterThanOrEqual(1440);
	});

	it('CRON-13: Feb 29 schedule skips non-leap years to the next leap year', () => {
		const next = nextCronRuns('0 0 29 2 *', 'UTC', 1, new Date('2026-06-08T12:00:00Z'))[0];
		expect(next.toISOString()).toBe('2028-02-29T00:00:00.000Z');
		// Accepted (smallest gap is years, far above the minimum).
		expect(() => validateCronSchedule('0 0 29 2 *', 'UTC')).not.toThrow();
	});

	it('CRON-14: half-hour timezone offset (Asia/Kolkata, UTC+5:30) computes the correct instant', () => {
		// 09:00 Kolkata = 03:30 UTC.
		expect(
			nextCronRuns(
				'0 9 * * *',
				'Asia/Kolkata',
				1,
				new Date('2026-06-08T00:00:00Z'),
			)[0].toISOString(),
		).toBe('2026-06-08T03:30:00.000Z');
	});

	it('CRON-15: DST fall-back (autumn) — a daily schedule shifts CEST→CET correctly', () => {
		// Europe/Bratislava falls back 2026-10-25 (03:00 -> 02:00). 04:00 local is unambiguous:
		// 02:00Z on Oct 24 (CEST, UTC+2) and 03:00Z from Oct 25 on (CET, UTC+1).
		const runs = nextCronRuns(
			'0 4 * * *',
			'Europe/Bratislava',
			3,
			new Date('2026-10-23T12:00:00Z'),
		);
		expect(runs.map((d) => d.toISOString())).toEqual([
			'2026-10-24T02:00:00.000Z',
			'2026-10-25T03:00:00.000Z',
			'2026-10-26T03:00:00.000Z',
		]);
	});

	it('CRON-16: day-of-month 31 skips months without a 31st', () => {
		const runs = nextCronRuns('0 0 31 * *', 'UTC', 3, new Date('2026-01-15T00:00:00Z'));
		expect(runs.map((d) => d.toISOString())).toEqual([
			'2026-01-31T00:00:00.000Z',
			'2026-03-31T00:00:00.000Z',
			'2026-05-31T00:00:00.000Z',
		]);
	});

	it('CRON-17: nextCronRuns with count <= 0 returns an empty array', () => {
		expect(nextCronRuns('0 * * * *', 'UTC', 0)).toEqual([]);
		expect(nextCronRuns('0 * * * *', 'UTC', -3)).toEqual([]);
	});

	it('CRON-18: min-interval boundary — exactly at the limit accepted, one below rejected', () => {
		expect(() => validateCronSchedule('*/5 * * * *', 'UTC', 5)).not.toThrow();
		expect(() => validateCronSchedule('*/4 * * * *', 'UTC', 5)).toThrow(/too frequently/);
		// Custom higher minimum rejects an otherwise-fine 5-minute schedule.
		expect(() => validateCronSchedule('*/5 * * * *', 'UTC', 10)).toThrow(/too frequently/);
		expect(() => validateCronSchedule('*/15 * * * *', 'UTC', 10)).not.toThrow();
	});

	it('CRON-19: isValidTimezone accepts case-insensitive UTC and rejects empty/null/garbage', () => {
		expect(isValidTimezone('UTC')).toBe(true);
		expect(isValidTimezone('utc')).toBe(true);
		expect(isValidTimezone('Asia/Kolkata')).toBe(true);
		expect(isValidTimezone('')).toBe(false);
		expect(isValidTimezone('   ')).toBe(false);
		expect(isValidTimezone(null)).toBe(false);
		expect(isValidTimezone(undefined)).toBe(false);
		expect(isValidTimezone('Not/AZone')).toBe(false);
	});

	it('CRON-20: nextCronRun is strictly after the given instant even when on an exact slot', () => {
		const at = new Date('2026-06-08T11:00:00.000Z');
		expect(nextCronRun('0 * * * *', 'UTC', at).toISOString()).toBe('2026-06-08T12:00:00.000Z');
	});

	it('CRON-21: validateCronSchedule rejects an out-of-range field', () => {
		expect(() => validateCronSchedule('0 25 * * *', 'UTC')).toThrow(CronScheduleError); // hour 25
		expect(() => validateCronSchedule('0 0 32 * *', 'UTC')).toThrow(CronScheduleError); // day 32
	});
});
