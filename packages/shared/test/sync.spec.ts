import { describe, expect, it } from 'vitest';
import type { SyncLogDto, SyncLogErrorEntryDto, SyncStatusResponseDto } from '@shared/sync.js';
import { SYNC_API_PATH } from '@shared/sync.js';

describe('sync shared types', () => {
	it('SH-SYNC-01: SYNC_API_PATH export', () => {
		expect(SYNC_API_PATH).toBe('/api/admin/sync');
	});

	it('SH-SYNC-02: SyncLogErrorEntryDto phase union includes dry_run_summary and user_limit', () => {
		const dryRun: SyncLogErrorEntryDto = {
			phase: 'dry_run_summary',
			message: 'Dry run completed',
		};
		const limit: SyncLogErrorEntryDto = {
			phase: 'user_limit',
			message: 'Too many users',
		};
		expect(dryRun.phase).toBe('dry_run_summary');
		expect(limit.phase).toBe('user_limit');
	});

	it('SH-SYNC-03: SyncStatusResponseDto shape', () => {
		const status: SyncStatusResponseDto = {
			connectionId: 'conn-1',
			lastSyncAt: null,
			lastSyncStatus: 'NEVER',
			syncInProgress: false,
			latestSyncLog: null,
		};
		expect(status.syncInProgress).toBe(false);
	});

	it('SH-SYNC-04: SyncLogDto includes durationMs and dryRun', () => {
		const log: SyncLogDto = {
			id: 'log-1',
			apiConnectionId: 'conn-1',
			startedAt: '2026-01-01T00:00:00.000Z',
			finishedAt: '2026-01-01T00:00:01.000Z',
			durationMs: 1000,
			status: 'SUCCESS',
			usersSynced: 1,
			groupsSynced: 0,
			rolesSynced: 0,
			dryRun: false,
			errors: null,
		};
		expect(log.durationMs).toBe(1000);
	});
});
