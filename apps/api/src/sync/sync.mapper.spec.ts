import type { ApiConnection, SyncLog } from '@prisma/client';
import {
	DRY_RUN_SUMMARY_PHASE,
	parseSyncLogErrors,
	toSyncLogDto,
	toSyncStatusResponseDto,
} from './sync.mapper';

describe('sync.mapper', () => {
	const baseLog: SyncLog = {
		id: 'log-1',
		apiConnectionId: 'conn-1',
		startedAt: new Date('2026-01-01T00:00:00.000Z'),
		finishedAt: new Date('2026-01-01T00:00:01.500Z'),
		status: 'SUCCESS',
		usersSynced: 2,
		groupsSynced: 1,
		rolesSynced: 1,
		errors: null,
	};

	const baseConnection: ApiConnection = {
		id: 'conn-1',
		name: 'Test API',
		baseUrl: 'https://identity.example.com',
		authType: 'BEARER',
		authCredentialsEncrypted: 'enc',
		lastSyncAt: new Date('2026-01-01T00:00:01.500Z'),
		lastSyncStatus: 'SUCCESS',
		createdAt: new Date('2025-12-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:01.500Z'),
	};

	it('API-SYNC-MAP-01: durationMs computed correctly when finished', () => {
		const dto = toSyncLogDto(baseLog);
		expect(dto.durationMs).toBe(1500);
		expect(dto.startedAt).toBe('2026-01-01T00:00:00.000Z');
		expect(dto.finishedAt).toBe('2026-01-01T00:00:01.500Z');
	});

	it('API-SYNC-MAP-02: durationMs is null when finishedAt null', () => {
		const dto = toSyncLogDto({ ...baseLog, finishedAt: null, status: 'RUNNING' });
		expect(dto.durationMs).toBeNull();
		expect(dto.finishedAt).toBeNull();
	});

	it('API-SYNC-MAP-03: errors: null in DB maps to null in DTO', () => {
		const dto = toSyncLogDto(baseLog);
		expect(dto.errors).toBeNull();
		expect(parseSyncLogErrors(null)).toBeNull();
	});

	it('API-SYNC-MAP-04: Invalid JSON in errors column → null (never throw)', () => {
		const dto = toSyncLogDto({ ...baseLog, errors: { not: 'an array' } });
		expect(dto.errors).toBeNull();
		expect(parseSyncLogErrors({ not: 'an array' })).toBeNull();
		expect(parseSyncLogErrors('string')).toBeNull();
	});

	it('API-SYNC-MAP-05: dryRun: true when dry_run_summary phase present', () => {
		const dto = toSyncLogDto({
			...baseLog,
			errors: [{ phase: DRY_RUN_SUMMARY_PHASE, message: 'Dry run completed' }],
		});
		expect(dto.dryRun).toBe(true);
	});

	it('API-SYNC-MAP-06: dryRun: false for normal success log', () => {
		const dto = toSyncLogDto({
			...baseLog,
			errors: [{ phase: 'parse_users', message: 'Invalid user row' }],
		});
		expect(dto.dryRun).toBe(false);
	});

	it('toSyncStatusResponseDto maps connection and syncInProgress flag', () => {
		const status = toSyncStatusResponseDto(baseConnection, baseLog, true);
		expect(status).toEqual({
			connectionId: 'conn-1',
			lastSyncAt: '2026-01-01T00:00:01.500Z',
			lastSyncStatus: 'SUCCESS',
			syncInProgress: true,
			latestSyncLog: expect.objectContaining({ id: 'log-1' }),
		});
	});
});
