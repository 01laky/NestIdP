export const AUTH_TYPES = ['BEARER', 'OAUTH2_CLIENT_CREDENTIALS'] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

export const LAST_SYNC_STATUSES = ['NEVER', 'IN_PROGRESS', 'SUCCESS', 'FAILED'] as const;
export type LastSyncStatus = (typeof LAST_SYNC_STATUSES)[number];

export const SYNC_LOG_STATUSES = ['RUNNING', 'SUCCESS', 'FAILED'] as const;
export type SyncLogStatus = (typeof SYNC_LOG_STATUSES)[number];

export function isAuthType(value: string): value is AuthType {
	return (AUTH_TYPES as readonly string[]).includes(value);
}

export function isLastSyncStatus(value: string): value is LastSyncStatus {
	return (LAST_SYNC_STATUSES as readonly string[]).includes(value);
}

export function isSyncLogStatus(value: string): value is SyncLogStatus {
	return (SYNC_LOG_STATUSES as readonly string[]).includes(value);
}
