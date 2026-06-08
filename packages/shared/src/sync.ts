import type { ApiConnectionDto } from './connections.js';
import type { LastSyncStatus, SyncLogStatus, SyncTriggerSource } from './schema-enums.js';

/** Admin REST API base path for identity sync (not the React route). */
export const SYNC_API_PATH = '/api/admin/sync';

/** Single sync log entry (never includes secrets). */
export interface SyncLogDto {
	id: string;
	apiConnectionId: string;
	startedAt: string;
	finishedAt: string | null;
	/** Milliseconds between startedAt and finishedAt; null while RUNNING or if unfinished. */
	durationMs: number | null;
	status: SyncLogStatus;
	usersSynced: number;
	groupsSynced: number;
	rolesSynced: number;
	/** True when run was POST with dryRun — detected via dry_run_summary error entry. */
	dryRun: boolean;
	/** How the run was started; null on legacy rows is treated as 'manual'. */
	triggerSource: SyncTriggerSource;
	errors: SyncLogErrorEntryDto[] | null;
}

/** Structured per-run error (stored in SyncLog.errors JSON). */
export interface SyncLogErrorEntryDto {
	phase:
		| 'decrypt_credentials'
		| 'oauth'
		| 'fetch_users'
		| 'parse_users'
		| 'upsert_user'
		| 'fetch_groups'
		| 'parse_groups'
		| 'upsert_group'
		| 'fetch_roles'
		| 'parse_roles'
		| 'upsert_role'
		| 'deactivate_users'
		| 'cleanup_orphans'
		| 'concurrency'
		| 'dry_run_summary'
		| 'user_limit';
	externalUserId?: string;
	externalGroupId?: string;
	externalRoleId?: string;
	message: string;
	httpStatus?: number;
}

export interface TriggerSyncRequestDto {
	/** When true, validate and fetch external API but do not mutate User/Group/Role tables. */
	dryRun?: boolean;
}

export interface TriggerSyncResponseDto {
	syncLog: SyncLogDto;
	/** Unchanged from pre-trigger state when dryRun is true. */
	connection: ApiConnectionDto;
}

export interface SyncLogResponseDto {
	syncLog: SyncLogDto;
}

export interface SyncLogListResponseDto {
	syncLogs: SyncLogDto[];
}

/** Lightweight sync status for dashboard / Prompt 08 (no trigger side effects). */
export interface SyncStatusResponseDto {
	connectionId: string;
	lastSyncAt: string | null;
	lastSyncStatus: LastSyncStatus;
	/** True when a non-stale sync is in progress. */
	syncInProgress: boolean;
	/** Most recent SyncLog for this connection; null if never synced. */
	latestSyncLog: SyncLogDto | null;
}
