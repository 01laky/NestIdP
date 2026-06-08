import type { ApiConnection } from '@prisma/client';
import {
	schedulePreviewRuns,
	toApiConnectionScheduleDto,
	toSchedulesOverviewItemDto,
} from '@api/sync/mappers/schedule.mapper';
import { SCHEDULE_FIELD_DEFAULTS } from '../../support/prisma/test-fixtures';

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

describe('schedulePreviewRuns', () => {
	it('returns an empty array when no cron is set', () => {
		expect(schedulePreviewRuns(makeConn({ scheduleCron: null }), 5)).toEqual([]);
	});

	it('returns ISO instants for a valid cron + timezone', () => {
		const runs = schedulePreviewRuns(
			makeConn({ scheduleCron: '0 * * * *', scheduleTimezone: 'UTC' }),
			3,
		);
		expect(runs).toHaveLength(3);
		for (const iso of runs) {
			expect(iso).toMatch(/T\d{2}:00:00\.000Z$/); // top of the hour
		}
	});

	it('never throws on an invalid cron — returns an empty array', () => {
		expect(schedulePreviewRuns(makeConn({ scheduleCron: 'not a cron' }), 5)).toEqual([]);
	});

	it('defaults to UTC when the timezone is null', () => {
		const runs = schedulePreviewRuns(
			makeConn({ scheduleCron: '0 0 * * *', scheduleTimezone: null }),
			1,
		);
		expect(runs).toHaveLength(1);
	});
});

describe('toApiConnectionScheduleDto', () => {
	it('maps all fields, converting dates to ISO and preserving nulls', () => {
		const dto = toApiConnectionScheduleDto(
			makeConn({
				scheduleEnabled: true,
				schedulePaused: true,
				scheduleDryRun: true,
				scheduleCron: '*/15 * * * *',
				scheduleTimezone: 'Europe/Bratislava',
				nextRunAt: new Date('2026-06-08T10:30:00.000Z'),
				lastScheduledRunAt: new Date('2026-06-08T10:15:00.000Z'),
				lastScheduledRunStatus: 'FAILED',
				scheduleLastError: 'HTTP 500',
				scheduleConsecutiveFailures: 2,
				scheduleAutoPausedAt: new Date('2026-06-08T09:00:00.000Z'),
			}),
			5,
		);
		expect(dto).toMatchObject({
			connectionId: 'conn-1',
			scheduleEnabled: true,
			schedulePaused: true,
			scheduleDryRun: true,
			scheduleCron: '*/15 * * * *',
			scheduleTimezone: 'Europe/Bratislava',
			nextRunAt: '2026-06-08T10:30:00.000Z',
			lastScheduledRunAt: '2026-06-08T10:15:00.000Z',
			lastScheduledRunStatus: 'FAILED',
			scheduleLastError: 'HTTP 500',
			scheduleConsecutiveFailures: 2,
			scheduleAutoPausedAt: '2026-06-08T09:00:00.000Z',
		});
		expect(dto.nextRuns).toHaveLength(5);
	});

	it('returns an empty preview + null instants for a never-configured connection', () => {
		const dto = toApiConnectionScheduleDto(makeConn(), 5);
		expect(dto.scheduleEnabled).toBe(false);
		expect(dto.scheduleCron).toBeNull();
		expect(dto.nextRunAt).toBeNull();
		expect(dto.lastScheduledRunStatus).toBeNull();
		expect(dto.nextRuns).toEqual([]);
	});
});

describe('toSchedulesOverviewItemDto', () => {
	it('includes the connection name and schedule state', () => {
		const item = toSchedulesOverviewItemDto(
			makeConn({
				name: 'HR',
				scheduleEnabled: true,
				scheduleCron: '0 2 * * *',
				scheduleTimezone: 'UTC',
			}),
		);
		expect(item).toMatchObject({
			connectionId: 'conn-1',
			connectionName: 'HR',
			scheduleEnabled: true,
			scheduleCron: '0 2 * * *',
			scheduleTimezone: 'UTC',
		});
	});
});
