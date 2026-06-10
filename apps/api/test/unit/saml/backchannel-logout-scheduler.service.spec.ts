import { ConfigService } from '@nestjs/config';
import { BackchannelLogoutSchedulerService } from '@api/saml/services/backchannel-logout-scheduler.service';
import type { BackchannelLogoutConfig } from '@api/saml/services/backchannel-logout.config';
import type { LogoutPropagationService } from '@api/saml/services/logout-propagation.service';

/**
 * Back-channel SLO retry scheduler (Prompt 36, BC-PROP-04/05). Single in-process `setInterval`,
 * `TICK_MS=0` disables, `MIGRATE_ONLY` skips, re-entrancy-guarded, never throws out of a tick,
 * `onModuleDestroy` clears the interval. Mirrors the cert-rotation scheduler.
 */
describe('BackchannelLogoutSchedulerService (BC-PROP scheduler)', () => {
	function build(opts: {
		tickMs: number;
		pruneIntervalMs?: number;
		migrateOnly?: string;
		processDue?: jest.Mock;
		prune?: jest.Mock;
	}) {
		const processDue = opts.processDue ?? jest.fn().mockResolvedValue(0);
		const prune = opts.prune ?? jest.fn().mockResolvedValue(0);
		const propagation = { processDue, prune } as unknown as LogoutPropagationService;
		const config = {
			schedulerTickMs: () => opts.tickMs,
			pruneIntervalMs: () => opts.pruneIntervalMs ?? 0,
		} as unknown as BackchannelLogoutConfig;
		const configService = {
			get: (key: string) => (key === 'MIGRATE_ONLY' ? opts.migrateOnly : undefined),
		} as unknown as ConfigService;
		const scheduler = new BackchannelLogoutSchedulerService(propagation, config, configService);
		return { scheduler, processDue, prune };
	}

	afterEach(() => {
		jest.useRealTimers();
	});

	it('BC-PROP-04: TICK_MS=0 disables the scheduler (no interval, no processing)', () => {
		jest.useFakeTimers();
		const { scheduler, processDue } = build({ tickMs: 0 });
		scheduler.onModuleInit();
		jest.advanceTimersByTime(120_000);
		expect(processDue).not.toHaveBeenCalled();
		scheduler.onModuleDestroy(); // no-op, must not throw
	});

	it('MIGRATE_ONLY skips scheduler startup', () => {
		jest.useFakeTimers();
		const { scheduler, processDue } = build({ tickMs: 30_000, migrateOnly: 'true' });
		scheduler.onModuleInit();
		jest.advanceTimersByTime(120_000);
		expect(processDue).not.toHaveBeenCalled();
	});

	it('runs processDue on each interval tick when enabled', async () => {
		jest.useFakeTimers();
		const { scheduler, processDue } = build({ tickMs: 1_000 });
		scheduler.onModuleInit();
		jest.advanceTimersByTime(1_000);
		await Promise.resolve();
		expect(processDue).toHaveBeenCalledTimes(1);
		jest.advanceTimersByTime(1_000);
		await Promise.resolve();
		expect(processDue).toHaveBeenCalledTimes(2);
		scheduler.onModuleDestroy();
	});

	it('BC-PROP-05: onModuleDestroy clears the interval (no further ticks)', async () => {
		jest.useFakeTimers();
		const { scheduler, processDue } = build({ tickMs: 1_000 });
		scheduler.onModuleInit();
		jest.advanceTimersByTime(1_000);
		await Promise.resolve();
		expect(processDue).toHaveBeenCalledTimes(1);
		scheduler.onModuleDestroy();
		jest.advanceTimersByTime(5_000);
		await Promise.resolve();
		expect(processDue).toHaveBeenCalledTimes(1);
	});

	it('BC-PROP-05b: re-entrancy guard — a slow tick never overlaps the next', async () => {
		// processDue never resolves → the guard must keep the second runTick from invoking it again.
		const processDue = jest.fn().mockReturnValue(new Promise<number>(() => {}));
		const { scheduler } = build({ tickMs: 1_000, processDue });
		void scheduler.runTick(); // claims the guard, hangs inside processDue
		await scheduler.runTick(); // must return immediately without a second processDue call
		expect(processDue).toHaveBeenCalledTimes(1);
	});

	it('never throws out of a tick when processDue rejects', async () => {
		const processDue = jest.fn().mockRejectedValue(new Error('db down'));
		const { scheduler } = build({ tickMs: 1_000, processDue });
		await expect(scheduler.runTick()).resolves.toBeUndefined();
		// guard is released so a subsequent tick can run again
		await expect(scheduler.runTick()).resolves.toBeUndefined();
		expect(processDue).toHaveBeenCalledTimes(2);
	});

	it('BC-PROP-06: tickStats is null before the first tick, then records lastTickAt + processed count', async () => {
		const processDue = jest.fn().mockResolvedValue(4);
		const { scheduler } = build({ tickMs: 1_000, processDue });
		expect(scheduler.tickStats()).toEqual({ lastTickAt: null, lastProcessed: null });

		await scheduler.runTick();

		const stats = scheduler.tickStats();
		expect(stats.lastProcessed).toBe(4);
		expect(stats.lastTickAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('prunes on a tick when the prune interval has elapsed', async () => {
		const prune = jest.fn().mockResolvedValue(3);
		const { scheduler } = build({ tickMs: 1_000, pruneIntervalMs: 1, prune });
		await scheduler.runTick();
		expect(prune).toHaveBeenCalledTimes(1);
	});

	it('never prunes when the prune interval is 0 (disabled)', async () => {
		const prune = jest.fn().mockResolvedValue(0);
		const { scheduler } = build({ tickMs: 1_000, pruneIntervalMs: 0, prune });
		await scheduler.runTick();
		expect(prune).not.toHaveBeenCalled();
	});
});
