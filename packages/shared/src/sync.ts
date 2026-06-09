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
	/** Cross-connection username collisions skipped in this run (Prompt 37; present from v1.18.0). */
	usersSkippedCollision?: number;
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
		| 'user_limit'
		| 'username_collision'
		// §5.B3: an unexpected internal failure (e.g. a throw in the membership/deactivation phase) so a
		// FAILED run is always self-describing rather than showing an empty error list.
		| 'internal';
	externalUserId?: string;
	externalGroupId?: string;
	externalRoleId?: string;
	message: string;
	httpStatus?: number;
	// --- username collision context (Prompt 37; no secrets) ---
	/** The username that collided. */
	username?: string;
	/** The connection that currently owns the username (the record kept). */
	ownerApiConnectionId?: string;
	/** Resolved owner label — connection name, or "Local directory" for a manual owner. */
	ownerLabel?: string;
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

// --- "Sync all sources" bulk trigger (Prompt 37) ------------------------------------------------

/** REST sub-path for the bulk trigger: `${SYNC_API_PATH}/all`. */
export const SYNC_ALL_API_PATH = '/api/admin/sync/all';

export interface SyncAllRequestDto {
	/** When true, every connection runs in dry-run (no writes) — a cross-source preview. */
	dryRun?: boolean;
}

export type SyncAllConnectionStatus = 'succeeded' | 'failed' | 'skipped_in_progress' | 'excluded';

export interface SyncAllConnectionResultDto {
	connectionId: string;
	name: string;
	status: SyncAllConnectionStatus;
	usersSynced: number;
	groupsSynced: number;
	rolesSynced: number;
	usersSkippedCollision: number;
	/** Redacted reason on failure / why it was skipped. */
	message?: string;
}

export interface SyncAllResponseDto {
	dryRun: boolean;
	results: SyncAllConnectionResultDto[];
	totals: {
		connections: number;
		succeeded: number;
		failed: number;
		skippedInProgress: number;
		excluded: number;
		usersSynced: number;
		usersSkippedCollision: number;
	};
}
