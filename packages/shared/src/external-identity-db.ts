/**
 * Shared contract for the external identity database feature (Prompt 31 / v1.12.0).
 * Identity entities (users/groups/roles) can be relocated to — or mirrored into — an external
 * Postgres/MySQL database, configured at runtime from the admin console. Secrets are never returned.
 */

export type ExternalDbDialect = 'postgres' | 'mysql';
export type ExternalDbSslMode = 'disable' | 'require' | 'verify-ca' | 'verify-full';
export type ExternalDbStatus = 'disconnected' | 'testing' | 'migrating' | 'active' | 'error';
export type ExternalDbMode = 'relocate' | 'mirror';
export type ExternalDbOwnership = 'empty' | 'ours' | 'foreign';

export const EXTERNAL_DB_DIALECTS: ExternalDbDialect[] = ['postgres', 'mysql'];
export const EXTERNAL_DB_SSL_MODES: ExternalDbSslMode[] = ['disable', 'require', 'verify-ca', 'verify-full'];

/** Connection attributes accepted by test/preview/connect. Password is write-only. */
export interface ExternalDbConnectionInput {
	dialect: ExternalDbDialect;
	host: string;
	port: number;
	database: string;
	username: string;
	/** Optional on connect/preview when a password is already stored (leave blank to keep). */
	password?: string;
	sslMode: ExternalDbSslMode;
	sslCaCertPem?: string | null;
	pgSchema?: string | null;
}

export interface TestExternalDbResponseDto {
	ok: boolean;
	dialect: ExternalDbDialect;
	serverVersion?: string;
	error?: string;
}

export interface ExternalDbPreviewResponseDto {
	reachable: boolean;
	ownership: ExternalDbOwnership;
	schemaPresent: boolean;
	willWipeLocal: boolean;
	toCreate: { users: number; groups: number; roles: number };
	toUpdate: { users: number; groups: number; roles: number };
	conflicts: Array<{ kind: 'username' | 'external_id'; table: 'user' | 'group' | 'role'; value: string }>;
	error?: string;
}

export interface ConnectExternalDbRequest extends ExternalDbConnectionInput {
	/** true = keep identity locally too (mirror); false (default) = relocate + wipe local. */
	keepLocalCopy?: boolean;
	/** Required to proceed with the destructive local wipe in relocate mode. */
	acknowledgeBackup?: boolean;
}

export interface DisconnectExternalDbRequest {
	/** Move identity data back to local SQLite before detaching (default true in the UI). */
	moveDataToLocal: boolean;
	/** Required to detach in relocate mode WITHOUT moving data back (leaves local identity empty). */
	acknowledgeDataLoss?: boolean;
}

export interface ExternalDbStatusResponseDto {
	configured: boolean;
	status: ExternalDbStatus;
	mode: ExternalDbMode;
	dialect?: ExternalDbDialect;
	host?: string;
	port?: number;
	database?: string;
	username?: string;
	sslMode?: ExternalDbSslMode;
	keepLocalCopy: boolean;
	hasPassword: boolean;
	reachable: boolean;
	breaker?: 'closed' | 'open' | 'half-open';
	outOfSync: boolean;
	schemaVersion: number;
	counts?: { users: number; groups: number; roles: number };
	migration?: { phase: string | null; done: number; total: number };
	lastError?: string | null;
	lastSyncAt?: string | null;
	connectedAt?: string | null;
	backupPath?: string | null;
}

export interface ConnectExternalDbResponseDto {
	status: ExternalDbStatusResponseDto;
	imported: { users: number; groups: number; roles: number };
	localWiped: boolean;
	backupPath?: string | null;
	wipeSkipped?: boolean;
}
