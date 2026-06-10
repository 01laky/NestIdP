import type { ApiConnection, SyncLog } from '@prisma/client';
import {
	DRY_RUN_SUMMARY_PHASE,
	parseSyncLogErrors,
	toSyncLogDto,
	toSyncStatusResponseDto,
} from '@api/sync/mappers/sync.mapper';
import {
	MULTI_SOURCE_FIELD_DEFAULTS,
	PROXY_FIELD_DEFAULTS,
	SCHEDULE_FIELD_DEFAULTS,
} from '../../support/prisma/test-fixtures';

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
		usersSkippedCollision: 0,
		errors: null,
		triggerSource: null,
	};

	const baseConnection: ApiConnection = {
		id: 'conn-1',
		name: 'Test API',
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
		lastSyncAt: new Date('2026-01-01T00:00:01.500Z'),
		lastSyncStatus: 'SUCCESS',
		...SCHEDULE_FIELD_DEFAULTS,
		...PROXY_FIELD_DEFAULTS,
		...MULTI_SOURCE_FIELD_DEFAULTS,
		createdAt: new Date('2025-12-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:01.500Z'),
	};

	it('API-SYNC-MAP-01: durationMs computed correctly when finished', () => {
		const dto = toSyncLogDto(baseLog);
		expect(dto.durationMs).toBe(1500);
		expect(dto.startedAt).toBe('2026-01-01T00:00:00.000Z');
		expect(dto.finishedAt).toBe('2026-01-01T00:00:01.500Z');
	});

	it('API-SYNC-MAP-07: triggerSource null (legacy) maps to "manual"; explicit values preserved', () => {
		expect(toSyncLogDto(baseLog).triggerSource).toBe('manual');
		expect(toSyncLogDto({ ...baseLog, triggerSource: 'scheduled' }).triggerSource).toBe(
			'scheduled',
		);
		expect(toSyncLogDto({ ...baseLog, triggerSource: 'manual' }).triggerSource).toBe('manual');
		// An unexpected stored value also falls back to manual.
		expect(toSyncLogDto({ ...baseLog, triggerSource: 'bogus' }).triggerSource).toBe('manual');
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

	it('API-SYNC-MAP-08: corrupt array elements are dropped, valid entries kept (§5.C)', () => {
		const corrupt = [
			{ phase: 'parse_users', message: 'kept', externalUserId: 'u1' },
			'junk-string',
			null,
			42,
			{ phase: 5, message: 'phase not a string' },
			{ phase: 'fetch_users' }, // missing message
			{ message: 'missing phase' },
		];
		expect(parseSyncLogErrors(corrupt)).toEqual([
			{ phase: 'parse_users', message: 'kept', externalUserId: 'u1' },
		]);
		const dto = toSyncLogDto({ ...baseLog, errors: corrupt as SyncLog['errors'] });
		expect(dto.errors).toHaveLength(1);
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
