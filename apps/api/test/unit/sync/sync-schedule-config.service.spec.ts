import { SyncScheduleConfigService } from '@api/sync/services/sync-schedule-config.service';

function configWith(values: Record<string, string | undefined>): SyncScheduleConfigService {
	const configService = { get: (key: string) => values[key] };
	return new SyncScheduleConfigService(configService as never);
}

describe('SyncScheduleConfigService (env bounding)', () => {
	it('returns documented defaults when env is unset', () => {
		const c = configWith({});
		expect(c.getTickMs()).toBe(30_000);
		expect(c.isSchedulerEnabled()).toBe(true);
		expect(c.getMinIntervalMinutes()).toBe(5);
		expect(c.getJitterMaxSeconds()).toBe(30);
		expect(c.getFailureAutopauseThreshold()).toBe(0);
		expect(c.getBootOverdueGraceMinutes()).toBe(0);
	});

	it('SYNC_SCHEDULER_TICK_MS=0 disables the scheduler', () => {
		const c = configWith({ SYNC_SCHEDULER_TICK_MS: '0' });
		expect(c.getTickMs()).toBe(0);
		expect(c.isSchedulerEnabled()).toBe(false);
	});

	it('clamps out-of-range / non-numeric values back to the default', () => {
		expect(configWith({ SYNC_SCHEDULER_TICK_MS: '-5' }).getTickMs()).toBe(30_000);
		expect(configWith({ SYNC_SCHEDULER_TICK_MS: '99999999' }).getTickMs()).toBe(30_000); // > 1h max
		expect(configWith({ SYNC_SCHEDULER_TICK_MS: 'abc' }).getTickMs()).toBe(30_000);
		expect(configWith({ SYNC_SCHEDULE_MIN_INTERVAL_MINUTES: '0' }).getMinIntervalMinutes()).toBe(5);
		expect(configWith({ SYNC_SCHEDULE_MIN_INTERVAL_MINUTES: '5000' }).getMinIntervalMinutes()).toBe(
			5,
		);
		expect(configWith({ SYNC_SCHEDULE_JITTER_MAX_SECONDS: '99999' }).getJitterMaxSeconds()).toBe(
			30,
		);
		expect(
			configWith({
				SYNC_SCHEDULE_FAILURE_AUTOPAUSE_THRESHOLD: '-1',
			}).getFailureAutopauseThreshold(),
		).toBe(0);
	});

	it('accepts valid in-range overrides', () => {
		expect(configWith({ SYNC_SCHEDULER_TICK_MS: '60000' }).getTickMs()).toBe(60_000);
		expect(configWith({ SYNC_SCHEDULE_MIN_INTERVAL_MINUTES: '15' }).getMinIntervalMinutes()).toBe(
			15,
		);
		expect(configWith({ SYNC_SCHEDULE_JITTER_MAX_SECONDS: '0' }).getJitterMaxSeconds()).toBe(0);
		expect(
			configWith({ SYNC_SCHEDULE_FAILURE_AUTOPAUSE_THRESHOLD: '3' }).getFailureAutopauseThreshold(),
		).toBe(3);
		expect(
			configWith({ SYNC_SCHEDULE_BOOT_OVERDUE_GRACE_MINUTES: '120' }).getBootOverdueGraceMinutes(),
		).toBe(120);
	});
});
