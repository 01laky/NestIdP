import { SyncLog } from '@prisma/client';
import type { SyncLogDto, SyncLogErrorEntryDto, SyncStatusResponseDto } from '@nestidp/shared';
import type { ApiConnection } from '@prisma/client';

export const DRY_RUN_SUMMARY_PHASE = 'dry_run_summary' as const;
export const DRY_RUN_SUMMARY_MESSAGE = 'Dry run completed; no identity rows were modified';

export function parseSyncLogErrors(errors: unknown): SyncLogErrorEntryDto[] | null {
	if (errors == null) {
		return null;
	}
	if (!Array.isArray(errors)) {
		return null;
	}
	return errors as SyncLogErrorEntryDto[];
}

export function isDryRunLog(errors: SyncLogErrorEntryDto[] | null): boolean {
	return errors?.some((entry) => entry.phase === DRY_RUN_SUMMARY_PHASE) ?? false;
}

export function toSyncLogDto(row: SyncLog): SyncLogDto {
	const errors = parseSyncLogErrors(row.errors);
	const startedAt = row.startedAt.toISOString();
	const finishedAt = row.finishedAt?.toISOString() ?? null;
	const durationMs =
		row.finishedAt != null ? row.finishedAt.getTime() - row.startedAt.getTime() : null;

	return {
		id: row.id,
		apiConnectionId: row.apiConnectionId,
		startedAt,
		finishedAt,
		durationMs,
		status: row.status,
		usersSynced: row.usersSynced,
		groupsSynced: row.groupsSynced,
		rolesSynced: row.rolesSynced,
		dryRun: isDryRunLog(errors),
		errors,
	};
}

export function toSyncStatusResponseDto(
	connection: ApiConnection,
	latestSyncLog: SyncLog | null,
	syncInProgress: boolean,
): SyncStatusResponseDto {
	return {
		connectionId: connection.id,
		lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
		lastSyncStatus: connection.lastSyncStatus,
		syncInProgress,
		latestSyncLog: latestSyncLog ? toSyncLogDto(latestSyncLog) : null,
	};
}
