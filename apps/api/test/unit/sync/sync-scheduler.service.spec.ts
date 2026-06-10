import type { ApiConnection } from '@prisma/client';
import { SyncSchedulerService } from '@api/sync/services/sync-scheduler.service';
import { SCHEDULE_FIELD_DEFAULTS } from '../../support/prisma/test-fixtures';

const NOW = new Date('2026-06-08T10:20:00.000Z');

function makeConn(overrides: Partial<ApiConnection> = {}): ApiConnection {
	return {
		id: 'conn-1',
		name: 'Corp API',
		baseUrl: 'https://identity.example.com',
		authType: 'BEARER',
		authCredentialsEncrypted: 'enc',
		isLocalDirectory: false,
		apiContractConfig: null,
		oauthTokenUrl: null,
		oauthClientId: null,
		oauthClientSecretEncrypted: null,
		oauthScope: null,
		oauthAudience: null,
		oauthClientAuthMethod: null,
		oauthTokenRequestParams: null,
		lastSyncAt: null,
		lastSyncStatus: 'NEVER',
		...SCHEDULE_FIELD_DEFAULTS,
		scheduleEnabled: true,
		scheduleCron: '*/15 * * * *',
		scheduleTimezone: 'UTC',
		nextRunAt: new Date('2026-06-08T10:15:00.000Z'),
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:00.000Z'),
		...overrides,
	} as ApiConnection;
}

describe('SyncSchedulerService', () => {
	let prisma: {
		apiConnection: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
	};
	let syncService: { triggerSync: jest.Mock; isSyncInProgress: jest.Mock };
	let audit: { recordSafe: jest.Mock };
	let notifier: { notifyFailure: jest.Mock };
	let config: {
		getTickMs: jest.Mock;
		isSchedulerEnabled: jest.Mock;
		getMinIntervalMinutes: jest.Mock;
		getJitterMaxSeconds: jest.Mock;
		getFailureAutopauseThreshold: jest.Mock;
		getBootOverdueGraceMinutes: jest.Mock;
	};
	let configService: { get: jest.Mock };
	let service: SyncSchedulerService;

	beforeEach(() => {
		prisma = {
			apiConnection: {
				findMany: jest.fn().mockResolvedValue([]),
				findUnique: jest.fn().mockResolvedValue(makeConn()),
				update: jest.fn().mockResolvedValue(makeConn()),
			},
		};
		syncService = {
			triggerSync: jest
				.fn()
				.mockResolvedValue({ syncLog: { id: 'log-1', status: 'SUCCESS' }, connection: {} }),
			isSyncInProgress: jest.fn().mockResolvedValue(false),
		};
		audit = { recordSafe: jest.fn() };
		notifier = { notifyFailure: jest.fn() };
		config = {
			getTickMs: jest.fn().mockReturnValue(30_000),
			isSchedulerEnabled: jest.fn().mockReturnValue(true),
			getMinIntervalMinutes: jest.fn().mockReturnValue(5),
			getJitterMaxSeconds: jest.fn().mockReturnValue(0),
			getFailureAutopauseThreshold: jest.fn().mockReturnValue(0),
			getBootOverdueGraceMinutes: jest.fn().mockReturnValue(0),
		};
		configService = { get: jest.fn().mockReturnValue(undefined) };
		service = new SyncSchedulerService(
			prisma as never,
			syncService as never,
			config as never,
			audit as never,
			configService as never,
			notifier as never,
		);
		jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
		jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
	});

	it('SCHED-01: a due connection is triggered as scheduled; nextRunAt advanced, lastScheduledRunAt set', async () => {
		prisma.apiConnection.findMany.mockResolvedValue([makeConn()]);
		await service.runTick(NOW);

		expect(syncService.triggerSync).toHaveBeenCalledWith('conn-1', {
			triggerSource: 'scheduled',
			dryRun: false,
		});
		const advance = prisma.apiConnection.update.mock.calls[0][0];
		expect(advance.data.lastScheduledRunAt).toBe(NOW);
		// next */15 strictly after 10:20 is 10:30
		expect((advance.data.nextRunAt as Date).toISOString()).toBe('2026-06-08T10:30:00.000Z');
		expect(audit.recordSafe).toHaveBeenCalledWith(
			expect.objectContaining({ event: 'sync_scheduled_run_started', actorType: 'system' }),
		);
	});

	it('SCHED-02/03: the due query only selects enabled, non-paused, non-local, due connections', async () => {
		await service.runTick(NOW);
		const where = prisma.apiConnection.findMany.mock.calls[0][0].where;
		expect(where).toEqual({
			scheduleEnabled: true,
			schedulePaused: false,
			isLocalDirectory: false,
			scheduleCron: { not: null },
			nextRunAt: { lte: NOW },
		});
	});

	it('SCHED-04: an in-progress connection is skipped (no double-run) and nextRunAt left intact', async () => {
		prisma.apiConnection.findMany.mockResolvedValue([makeConn()]);
		syncService.isSyncInProgress.mockResolvedValue(true);

		await service.runTick(NOW);

		expect(syncService.triggerSync).not.toHaveBeenCalled();
		expect(prisma.apiConnection.update).not.toHaveBeenCalled();
		expect(audit.recordSafe).toHaveBeenCalledWith(
			expect.objectContaining({
				event: 'sync_scheduled_run_skipped',
				metadata: expect.objectContaining({ reason: 'sync_in_progress' }),
			}),
		);
	});

	it('SCHED-05: overdue by many slots runs once, then advances to the next FUTURE occurrence', async () => {
		// nextRunAt far in the past — should not replay every missed slot.
		prisma.apiConnection.findMany.mockResolvedValue([
			makeConn({ nextRunAt: new Date('2026-06-08T06:00:00.000Z') }),
		]);
		await service.runTick(NOW);
		expect(syncService.triggerSync).toHaveBeenCalledTimes(1);
		const advance = prisma.apiConnection.update.mock.calls[0][0];
		expect((advance.data.nextRunAt as Date).toISOString()).toBe('2026-06-08T10:30:00.000Z');
	});

	it('SCHED-06: a triggerSync throw records the error and does not stall the other connections', async () => {
		prisma.apiConnection.findMany.mockResolvedValue([
			makeConn({ id: 'conn-1' }),
			makeConn({ id: 'conn-2' }),
		]);
		syncService.triggerSync.mockReset();
		syncService.triggerSync
			.mockRejectedValueOnce(new Error('boom'))
			.mockResolvedValueOnce({ syncLog: { id: 'log-2', status: 'SUCCESS' }, connection: {} });

		await service.runTick(NOW);

		expect(syncService.triggerSync).toHaveBeenCalledTimes(2);
		// conn-1 failure recorded
		const failUpdate = prisma.apiConnection.update.mock.calls.find(
			(c) => c[0].data.scheduleLastError === 'boom',
		);
		expect(failUpdate).toBeDefined();
	});

	it('SCHED-08: tickMs 0 disables the scheduler (no boot reconcile, no interval)', async () => {
		config.getTickMs.mockReturnValue(0);
		const setIntervalSpy = jest.spyOn(global, 'setInterval');
		await service.onModuleInit();
		expect(setIntervalSpy).not.toHaveBeenCalled();
		expect(prisma.apiConnection.findMany).not.toHaveBeenCalled();
		setIntervalSpy.mockRestore();
	});

	it('SCHED-08: MIGRATE_ONLY skips scheduler startup entirely', async () => {
		configService.get.mockReturnValue('1');
		const setIntervalSpy = jest.spyOn(global, 'setInterval');
		await service.onModuleInit();
		expect(setIntervalSpy).not.toHaveBeenCalled();
		setIntervalSpy.mockRestore();
	});

	it('SCHED-10: tickStats is null before the first tick, then records lastTickAt + due count', async () => {
		expect(service.tickStats()).toEqual({ lastTickAt: null, lastProcessed: null });

		prisma.apiConnection.findMany.mockResolvedValue([makeConn()]);
		await service.runTick(NOW);

		const stats = service.tickStats();
		expect(stats.lastProcessed).toBe(1);
		expect(stats.lastTickAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('SCHED-09: an overlapping tick is skipped while the previous tick is still running', async () => {
		service['ticking'] = true;
		await service.runTick(NOW);
		expect(prisma.apiConnection.findMany).not.toHaveBeenCalled();
	});

	it('SCHED-07/HARD-BOOT-01: boot advances a null or beyond-grace overdue schedule WITHOUT running', async () => {
		prisma.apiConnection.findMany.mockResolvedValue([
			makeConn({ nextRunAt: null }),
			makeConn({ id: 'conn-2', nextRunAt: new Date('2026-06-08T06:00:00.000Z') }),
		]);
		await service.reconcileOnBoot(NOW);
		// Both recomputed; never triggered on boot.
		expect(syncService.triggerSync).not.toHaveBeenCalled();
		expect(prisma.apiConnection.update).toHaveBeenCalledTimes(2);
		for (const call of prisma.apiConnection.update.mock.calls) {
			expect((call[0].data.nextRunAt as Date).getTime()).toBeGreaterThan(NOW.getTime());
		}
	});

	it('HARD-BOOT-01: boot leaves an overdue-within-grace schedule intact so the next tick runs it', async () => {
		config.getBootOverdueGraceMinutes.mockReturnValue(60);
		prisma.apiConnection.findMany.mockResolvedValue([
			makeConn({ nextRunAt: new Date('2026-06-08T10:00:00.000Z') }), // 20 min overdue <= 60
		]);
		await service.reconcileOnBoot(NOW);
		expect(prisma.apiConnection.update).not.toHaveBeenCalled();
	});

	it('SCHED-07: boot leaves a future nextRunAt untouched (survives restart)', async () => {
		prisma.apiConnection.findMany.mockResolvedValue([
			makeConn({ nextRunAt: new Date('2026-06-08T12:00:00.000Z') }),
		]);
		await service.reconcileOnBoot(NOW);
		expect(prisma.apiConnection.update).not.toHaveBeenCalled();
	});

	it('HARD-DRYRUN-01: a dry-run schedule triggers triggerSync with dryRun:true', async () => {
		prisma.apiConnection.findMany.mockResolvedValue([makeConn({ scheduleDryRun: true })]);
		await service.runTick(NOW);
		expect(syncService.triggerSync).toHaveBeenCalledWith('conn-1', {
			triggerSource: 'scheduled',
			dryRun: true,
		});
	});

	it('HARD-BACKOFF-01: a failed run increments the counter; reaching the threshold auto-pauses + notifies', async () => {
		config.getFailureAutopauseThreshold.mockReturnValue(2);
		prisma.apiConnection.findMany.mockResolvedValue([makeConn()]);
		// fresh read before increment: already 1 failure
		prisma.apiConnection.findUnique.mockResolvedValue(makeConn({ scheduleConsecutiveFailures: 1 }));
		syncService.triggerSync.mockResolvedValue({
			syncLog: {
				id: 'log-1',
				status: 'FAILED',
				errors: [{ phase: 'fetch_users', message: 'HTTP 500' }],
			},
			connection: {},
		});

		await service.runTick(NOW);

		const failUpdate = prisma.apiConnection.update.mock.calls.find(
			(c) => c[0].data.scheduleConsecutiveFailures === 2,
		);
		expect(failUpdate).toBeDefined();
		expect(failUpdate![0].data.schedulePaused).toBe(true);
		expect(failUpdate![0].data.scheduleAutoPausedAt).toBe(NOW);
		expect(audit.recordSafe).toHaveBeenCalledWith(
			expect.objectContaining({ event: 'sync_scheduled_run_failed' }),
		);
		expect(audit.recordSafe).toHaveBeenCalledWith(
			expect.objectContaining({ event: 'sync_schedule_auto_paused' }),
		);
		expect(notifier.notifyFailure).toHaveBeenCalledWith(
			expect.objectContaining({ autoPaused: true, consecutiveFailures: 2 }),
		);
	});

	it('HARD-BACKOFF-01: threshold 0 never auto-pauses', async () => {
		config.getFailureAutopauseThreshold.mockReturnValue(0);
		prisma.apiConnection.findMany.mockResolvedValue([makeConn()]);
		prisma.apiConnection.findUnique.mockResolvedValue(makeConn({ scheduleConsecutiveFailures: 9 }));
		syncService.triggerSync.mockResolvedValue({
			syncLog: { id: 'log-1', status: 'FAILED', errors: null },
			connection: {},
		});
		await service.runTick(NOW);
		const failUpdate = prisma.apiConnection.update.mock.calls.find(
			(c) => c[0].data.scheduleConsecutiveFailures === 10,
		);
		expect(failUpdate![0].data.schedulePaused).toBeUndefined();
		expect(notifier.notifyFailure).toHaveBeenCalledWith(
			expect.objectContaining({ autoPaused: false }),
		);
	});

	it('SCHED-01b: a successful scheduled run records lastScheduledRunStatus = SUCCESS', async () => {
		prisma.apiConnection.findMany.mockResolvedValue([makeConn()]);
		await service.runTick(NOW);
		const statusUpdate = prisma.apiConnection.update.mock.calls.find(
			(c) => c[0].data.lastScheduledRunStatus === 'SUCCESS',
		);
		expect(statusUpdate).toBeDefined();
	});

	it('SCHED-01c: multiple due connections are all triggered in one tick', async () => {
		prisma.apiConnection.findMany.mockResolvedValue([
			makeConn({ id: 'c1' }),
			makeConn({ id: 'c2' }),
			makeConn({ id: 'c3' }),
		]);
		await service.runTick(NOW);
		expect(syncService.triggerSync).toHaveBeenCalledTimes(3);
		expect(syncService.triggerSync).toHaveBeenCalledWith('c1', expect.anything());
		expect(syncService.triggerSync).toHaveBeenCalledWith('c2', expect.anything());
		expect(syncService.triggerSync).toHaveBeenCalledWith('c3', expect.anything());
	});

	it('HARD-JITTER-01 (tick): with jitter > 0 nextRunAt stays within the cron slot', async () => {
		config.getJitterMaxSeconds.mockReturnValue(30);
		prisma.apiConnection.findMany.mockResolvedValue([makeConn()]);
		await service.runTick(NOW);
		const next = prisma.apiConnection.update.mock.calls[0][0].data.nextRunAt as Date;
		const base = new Date('2026-06-08T10:30:00.000Z').getTime();
		expect(next.getTime()).toBeGreaterThanOrEqual(base);
		expect(next.getTime()).toBeLessThan(base + 30_000);
	});

	it('SCHED-LIFECYCLE: an invalid cron clears nextRunAt and records the error (stops being perpetually due)', async () => {
		prisma.apiConnection.findMany.mockResolvedValue([makeConn({ scheduleCron: 'not a cron' })]);
		await service.runTick(NOW);
		expect(syncService.triggerSync).not.toHaveBeenCalled();
		const errUpdate = prisma.apiConnection.update.mock.calls.find(
			(c) => c[0].data.nextRunAt === null && typeof c[0].data.scheduleLastError === 'string',
		);
		expect(errUpdate).toBeDefined();
	});

	it('HARD-LIFECYCLE-01: a connection deleted mid-tick (update rejects) does not throw or stall', async () => {
		prisma.apiConnection.findMany.mockResolvedValue([makeConn({ id: 'gone' })]);
		prisma.apiConnection.update.mockRejectedValue(new Error('Record to update not found'));
		await expect(service.runTick(NOW)).resolves.toBeUndefined();
		// The advance update failed before triggering, so no sync ran.
		expect(syncService.triggerSync).not.toHaveBeenCalled();
	});

	it('HARD-NOTIFY-01: the notifier receives the connection id/name and failure count on a failed run', async () => {
		prisma.apiConnection.findMany.mockResolvedValue([makeConn({ id: 'c9', name: 'Broken' })]);
		prisma.apiConnection.findUnique.mockResolvedValue(
			makeConn({ id: 'c9', name: 'Broken', scheduleConsecutiveFailures: 0 }),
		);
		syncService.triggerSync.mockResolvedValue({
			syncLog: {
				id: 'log-x',
				status: 'FAILED',
				errors: [{ phase: 'fetch_users', message: 'HTTP 503' }],
			},
			connection: {},
		});
		await service.runTick(NOW);
		expect(notifier.notifyFailure).toHaveBeenCalledWith(
			expect.objectContaining({
				connectionId: 'c9',
				connectionName: 'Broken',
				consecutiveFailures: 1,
				autoPaused: false,
				message: expect.stringContaining('HTTP 503'),
			}),
		);
	});

	it('onModuleInit starts the tick timer + runs boot reconcile; onModuleDestroy clears it', async () => {
		const fakeHandle = {} as ReturnType<typeof setInterval>;
		const setIntervalSpy = jest.spyOn(global, 'setInterval').mockReturnValue(fakeHandle);
		const clearIntervalSpy = jest
			.spyOn(global, 'clearInterval')
			.mockImplementation(() => undefined);

		await service.onModuleInit();
		expect(prisma.apiConnection.findMany).toHaveBeenCalled(); // boot reconcile ran
		expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);

		service.onModuleDestroy();
		expect(clearIntervalSpy).toHaveBeenCalledWith(fakeHandle);

		setIntervalSpy.mockRestore();
		clearIntervalSpy.mockRestore();
	});

	it('reconcileOnBoot only loads enabled, non-paused, non-local connections with a cron', async () => {
		await service.reconcileOnBoot(NOW);
		const where = prisma.apiConnection.findMany.mock.calls[0][0].where;
		expect(where).toEqual({
			scheduleEnabled: true,
			schedulePaused: false,
			isLocalDirectory: false,
			scheduleCron: { not: null },
		});
	});

	it('HARD-DRYRUN-01: a dry-run scheduled run still records lastScheduledRunStatus', async () => {
		prisma.apiConnection.findMany.mockResolvedValue([makeConn({ scheduleDryRun: true })]);
		await service.runTick(NOW);
		expect(syncService.triggerSync).toHaveBeenCalledWith('conn-1', {
			triggerSource: 'scheduled',
			dryRun: true,
		});
		const statusUpdate = prisma.apiConnection.update.mock.calls.find(
			(c) => c[0].data.lastScheduledRunStatus === 'SUCCESS',
		);
		expect(statusUpdate).toBeDefined();
	});
});
