export const AUTH_TYPES = ['BEARER', 'OAUTH2_CLIENT_CREDENTIALS'] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

export const LAST_SYNC_STATUSES = ['NEVER', 'IN_PROGRESS', 'SUCCESS', 'FAILED'] as const;
export type LastSyncStatus = (typeof LAST_SYNC_STATUSES)[number];

export const SYNC_LOG_STATUSES = ['RUNNING', 'SUCCESS', 'FAILED'] as const;
export type SyncLogStatus = (typeof SYNC_LOG_STATUSES)[number];

/**
 * How a sync run was started. Legacy rows (null) are treated as 'manual'.
 * `manual_all` is a per-connection run launched by the "sync all sources" bulk trigger (Prompt 37).
 */
export const SYNC_TRIGGER_SOURCES = ['manual', 'scheduled', 'manual_all'] as const;
export type SyncTriggerSource = (typeof SYNC_TRIGGER_SOURCES)[number];

export function isSyncTriggerSource(value: string): value is SyncTriggerSource {
	return (SYNC_TRIGGER_SOURCES as readonly string[]).includes(value);
}

/**
 * Cross-connection username collision policy (Prompt 37). `skip` (default) skips the conflicting record and
 * keeps the run successful; `fail_run` marks the colliding connection's run FAILED. The owner is never
 * overwritten and `User.username` stays globally unique.
 */
export const USERNAME_COLLISION_POLICIES = ['skip', 'fail_run'] as const;
export type UsernameCollisionPolicy = (typeof USERNAME_COLLISION_POLICIES)[number];

export function isUsernameCollisionPolicy(value: string): value is UsernameCollisionPolicy {
	return (USERNAME_COLLISION_POLICIES as readonly string[]).includes(value);
}

export function isAuthType(value: string): value is AuthType {
	return (AUTH_TYPES as readonly string[]).includes(value);
}

export function isLastSyncStatus(value: string): value is LastSyncStatus {
	return (LAST_SYNC_STATUSES as readonly string[]).includes(value);
}

export function isSyncLogStatus(value: string): value is SyncLogStatus {
	return (SYNC_LOG_STATUSES as readonly string[]).includes(value);
}
