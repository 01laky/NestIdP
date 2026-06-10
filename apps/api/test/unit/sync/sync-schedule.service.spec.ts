import type { ApiConnection } from '@prisma/client';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SyncScheduleService } from '@api/sync/services/sync-schedule.service';
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
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:00.000Z'),
		...overrides,
	} as ApiConnection;
}

describe('SyncScheduleService', () => {
	let prisma: {
		apiConnection: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
		syncLog: { count: jest.Mock };
	};
	let audit: { recordSafe: jest.Mock };
	let config: {
		getMinIntervalMinutes: jest.Mock;
		getJitterMaxSeconds: jest.Mock;
		isSchedulerEnabled: jest.Mock;
	};
	let service: SyncScheduleService;

	beforeEach(() => {
		prisma = {
			apiConnection: {
				findUnique: jest.fn().mockResolvedValue(makeConn()),
				findMany: jest.fn().mockResolvedValue([]),
				update: jest.fn(),
			},
			syncLog: { count: jest.fn().mockResolvedValue(0) },
		};
		audit = { recordSafe: jest.fn() };
		config = {
			getMinIntervalMinutes: jest.fn().mockReturnValue(5),
			getJitterMaxSeconds: jest.fn().mockReturnValue(0),
			isSchedulerEnabled: jest.fn().mockReturnValue(true),
		};
		// echo the update back as the persisted row
		prisma.apiConnection.update.mockImplementation(async ({ data }) =>
			makeConn({ ...(data as Partial<ApiConnection>) }),
		);
		service = new SyncScheduleService(prisma as never, config as never, audit as never);
	});

	it('API-SCHED-01: enabling a valid schedule persists it and returns nextRunAt + a preview', async () => {
		const res = await service.updateSchedule(
			'conn-1',
			{ scheduleEnabled: true, scheduleCron: '*/15 * * * *', scheduleTimezone: 'UTC' },
			NOW,
		);
		const data = prisma.apiConnection.update.mock.calls[0][0].data;
		expect(data.scheduleEnabled).toBe(true);
		expect(data.scheduleCron).toBe('*/15 * * * *');
		expect((data.nextRunAt as Date).toISOString()).toBe('2026-06-08T10:30:00.000Z');
		expect(res.schedule.nextRuns).toHaveLength(5);
		expect(audit.recordSafe).toHaveBeenCalledWith(
			expect.objectContaining({ event: 'sync_schedule_updated', actorType: 'admin' }),
		);
	});

	it('API-SCHED-02: an invalid cron is rejected with 400', async () => {
		await expect(
			service.updateSchedule('conn-1', { scheduleEnabled: true, scheduleCron: 'not-a-cron' }, NOW),
		).rejects.toBeInstanceOf(BadRequestException);
		expect(prisma.apiConnection.update).not.toHaveBeenCalled();
	});

	it('API-SCHED-02: an unknown timezone is rejected with 400', async () => {
		await expect(
			service.updateSchedule(
				'conn-1',
				{ scheduleEnabled: true, scheduleCron: '*/15 * * * *', scheduleTimezone: 'Mars/Phobos' },
				NOW,
			),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it('API-SCHED-02: a below-min-interval cron is rejected with 400', async () => {
		await expect(
			service.updateSchedule('conn-1', { scheduleEnabled: true, scheduleCron: '* * * * *' }, NOW),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it('API-SCHED-02: enabling without a cron is rejected', async () => {
		await expect(
			service.updateSchedule('conn-1', { scheduleEnabled: true }, NOW),
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it('API-SCHED-02: disabling clears nextRunAt', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(
			makeConn({
				scheduleEnabled: true,
				scheduleCron: '*/15 * * * *',
				scheduleTimezone: 'UTC',
				nextRunAt: new Date('2026-06-08T10:30:00.000Z'),
			}),
		);
		await service.updateSchedule('conn-1', { scheduleEnabled: false }, NOW);
		expect(prisma.apiConnection.update.mock.calls[0][0].data.nextRunAt).toBeNull();
	});

	it('HARD-PAUSE-01: pausing keeps the cron + nextRunAt intact', async () => {
		const existingNext = new Date('2026-06-08T10:30:00.000Z');
		prisma.apiConnection.findUnique.mockResolvedValue(
			makeConn({
				scheduleEnabled: true,
				scheduleCron: '*/15 * * * *',
				scheduleTimezone: 'UTC',
				nextRunAt: existingNext,
			}),
		);
		await service.updateSchedule('conn-1', { schedulePaused: true }, NOW);
		const data = prisma.apiConnection.update.mock.calls[0][0].data;
		expect(data.schedulePaused).toBe(true);
		expect(data.scheduleCron).toBe('*/15 * * * *');
		expect(data.nextRunAt).toBe(existingNext); // unchanged
	});

	it('HARD-PAUSE-01/BACKOFF: un-pausing clears the auto-pause + failure counter', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(
			makeConn({
				scheduleEnabled: true,
				scheduleCron: '*/15 * * * *',
				scheduleTimezone: 'UTC',
				schedulePaused: true,
				scheduleAutoPausedAt: new Date('2026-06-08T09:00:00.000Z'),
				scheduleConsecutiveFailures: 3,
				scheduleLastError: 'HTTP 500',
				nextRunAt: new Date('2026-06-08T10:30:00.000Z'),
			}),
		);
		await service.updateSchedule('conn-1', { schedulePaused: false }, NOW);
		const data = prisma.apiConnection.update.mock.calls[0][0].data;
		expect(data.scheduleAutoPausedAt).toBeNull();
		expect(data.scheduleConsecutiveFailures).toBe(0);
		expect(data.scheduleLastError).toBeNull();
	});

	it('HARD-LIFECYCLE-01: changing the cron recomputes nextRunAt cleanly', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(
			makeConn({
				scheduleEnabled: true,
				scheduleCron: '*/15 * * * *',
				scheduleTimezone: 'UTC',
				nextRunAt: new Date('2026-06-08T10:30:00.000Z'),
			}),
		);
		await service.updateSchedule('conn-1', { scheduleCron: '0 * * * *' }, NOW);
		const data = prisma.apiConnection.update.mock.calls[0][0].data;
		// hourly: next after 10:20 is 11:00
		expect((data.nextRunAt as Date).toISOString()).toBe('2026-06-08T11:00:00.000Z');
	});

	it('rejects scheduling the local-directory connection', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(makeConn({ isLocalDirectory: true }));
		await expect(
			service.updateSchedule('conn-1', { scheduleEnabled: false }, NOW),
		).rejects.toBeInstanceOf(ForbiddenException);
	});

	it('throws NotFound for an unknown connection', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(null);
		await expect(service.getSchedule('nope')).rejects.toBeInstanceOf(NotFoundException);
	});

	it('HARD-LIFECYCLE-01: changing only the timezone recomputes nextRunAt', async () => {
		prisma.apiConnection.findUnique.mockResolvedValue(
			makeConn({
				scheduleEnabled: true,
				scheduleCron: '0 2 * * *',
				scheduleTimezone: 'UTC',
				nextRunAt: new Date('2026-06-09T02:00:00.000Z'),
			}),
		);
		await service.updateSchedule('conn-1', { scheduleTimezone: 'Europe/Bratislava' }, NOW);
		const data = prisma.apiConnection.update.mock.calls[0][0].data;
		expect(data.scheduleTimezone).toBe('Europe/Bratislava');
		// 02:00 Bratislava (CEST, UTC+2) next after 2026-06-08T10:20Z = 2026-06-09T00:00Z
		expect((data.nextRunAt as Date).toISOString()).toBe('2026-06-09T00:00:00.000Z');
	});

	it('toggling only dry-run does not disturb nextRunAt or the cadence', async () => {
		const existingNext = new Date('2026-06-08T10:30:00.000Z');
		prisma.apiConnection.findUnique.mockResolvedValue(
			makeConn({
				scheduleEnabled: true,
				scheduleCron: '*/15 * * * *',
				scheduleTimezone: 'UTC',
				nextRunAt: existingNext,
			}),
		);
		await service.updateSchedule('conn-1', { scheduleDryRun: true }, NOW);
		const data = prisma.apiConnection.update.mock.calls[0][0].data;
		expect(data.scheduleDryRun).toBe(true);
		expect(data.nextRunAt).toBe(existingNext);
	});

	it('API-SCHED-01b: enabling with a named preset cron persists and computes nextRunAt', async () => {
		await service.updateSchedule(
			'conn-1',
			{ scheduleEnabled: true, scheduleCron: '0 6 * * 1-5', scheduleTimezone: 'UTC' },
			NOW,
		);
		const data = prisma.apiConnection.update.mock.calls[0][0].data;
		expect(data.scheduleCron).toBe('0 6 * * 1-5');
		expect(data.nextRunAt).toBeInstanceOf(Date);
		expect((data.nextRunAt as Date).getTime()).toBeGreaterThan(NOW.getTime());
	});

	it('HARD-OVERVIEW-01: overview lists scheduled connections + per-trigger-source run counts (§5.C)', async () => {
		prisma.apiConnection.findMany.mockResolvedValue([
			makeConn({ scheduleEnabled: true, scheduleCron: '*/15 * * * *' }),
		]);
		prisma.syncLog.count.mockImplementation(
			async ({ where }: { where: Record<string, unknown> }) => {
				if (where.triggerSource === 'scheduled') {
					return 4;
				}
				if (where.triggerSource === 'manual_all') {
					return 3;
				}
				// manual + legacy-null rows
				return 6;
			},
		);
		const res = await service.getOverview();
		expect(res.schedulerEnabled).toBe(true);
		expect(res.schedules).toHaveLength(1);
		expect(res.scheduledRunCount).toBe(4);
		// 'manual_all' runs no longer inflate the manual count (old code did total - scheduled).
		expect(res.manualRunCount).toBe(6);
		expect(res.manualAllRunCount).toBe(3);
		// Legacy null triggerSource rows are counted as manual via an explicit OR clause.
		expect(prisma.syncLog.count).toHaveBeenCalledWith({
			where: { OR: [{ triggerSource: 'manual' }, { triggerSource: null }] },
		});
	});
});
