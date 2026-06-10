import type { ApiConnectionDto } from './connections.js';
import type { IdpCertEcCurve, IdpCertKeyFamily } from './idp-cert-common.js';
import type { LastSyncStatus } from './schema-enums.js';
import type {
	AdminDashboardEncryptionCertStatus,
	AdminDashboardIdpCertStatus,
} from './idp-settings.js';
import { AUDIT_ROUTE_PREFIX } from './audit-events.js';
import { ADMIN_USERS_ROUTE_PREFIX } from './admin-users.js';

export interface AdminStatsDto {
	users: number;
	groups: number;
	roles: number;
	apiConnections: number;
	spConnections: number;
}

export interface AdminDashboardIdpStatusDto {
	idpSettingsRoute: string;
	hasSigningCertificate: boolean;
	rotationActive: boolean;
	signingCertNotAfter: string | null;
	signingKeyFamily: IdpCertKeyFamily | null;
	signingSignatureAlgorithmId: string | null;
	signingRsaModulusBits: number | null;
	signingEcCurve: IdpCertEcCurve | null;
	certStatus: AdminDashboardIdpCertStatus;
	hasEncryptionCertificate: boolean;
	encryptionRotationActive: boolean;
	encryptionCertNotAfter: string | null;
	encryptionKeyFamily: 'rsa' | 'ec' | null;
	encryptionKeyTransportAlgorithmId: string | null;
	encryptionRsaModulusBits: number | null;
	encryptionEcCurve: string | null;
	encryptionCertStatus: AdminDashboardEncryptionCertStatus;
}

export interface AdminDashboardSpSecuritySummaryDto {
	spConnectionsRequireSignedAuthn: number;
	spConnectionsRequireEncryptedAssertions: number;
	spConnectionsMissingCertWithSecurityFlags: number;
	idpAdvertisesSignedAuthnRequests: boolean;
	idpEncryptionKeyIsEc: boolean;
	activeSamlSessions: number;
	/** Sessions still unresolved at some SP via back-channel SLO (pending/in_flight/failed/given_up). */
	backchannelUnresolved: number;
}

/** Brute-force lockout summary for the dashboard security signal (Prompt 35). */
export interface AdminDashboardLockoutSummaryDto {
	lockedAdminAccounts: number;
	lockedUserAccounts: number;
}

export interface AdminDashboardResponseDto {
	counts: AdminStatsDto;
	/** Currently-locked account counts; present from v1.16.0. */
	lockouts?: AdminDashboardLockoutSummaryDto;
	apiConnectionsRoute: string;
	spConnectionsRoute: string;
	identityUsersRoute: string;
	apiConnectionsApiPath: string;
	syncApiPath: string;
	spConnectionsApiPath: string;
	metadataUrl: string;
	entityId: string;
	ssoUrl: string;
	idp: AdminDashboardIdpStatusDto;
	spSecurity: AdminDashboardSpSecuritySummaryDto;
	/** @deprecated since v1.18.0 — use `syncSources`. Kept for back-compat (the first non-local source). */
	apiConnection: ApiConnectionDto | null;
	lastSyncStatus: LastSyncStatus | null;
	lastSyncAt: string | null;
	/** All non-local sync sources with per-source status + counts (Prompt 37; present from v1.18.0). */
	syncSources?: AdminDashboardSyncSourceDto[];
	/** Manual/local-directory identity bucket count (Prompt 37). */
	manualIdentityCount?: number;
	/** Rollup for the "stale / failing sources" dashboard warning widget (Prompt 37). */
	syncSourceHealth?: AdminDashboardSyncSourceHealthDto;
	auditEventsRoute: typeof AUDIT_ROUTE_PREFIX;
	adminUsersRoute: typeof ADMIN_USERS_ROUTE_PREFIX;
}

/** A single sync source on the dashboard (Prompt 37). */
export type AdminDashboardSyncSourceState = 'ok' | 'never_synced' | 'failing' | 'overdue';

export interface AdminDashboardSyncSourceDto {
	apiConnectionId: string;
	name: string;
	lastSyncStatus: LastSyncStatus;
	lastSyncAt: string | null;
	userCount: number;
	groupCount: number;
	roleCount: number;
	lastCollisionCount: number;
	includeInSyncAll: boolean;
	state: AdminDashboardSyncSourceState;
}

export interface AdminDashboardSyncSourceHealthDto {
	total: number;
	neverSynced: number;
	failing: number;
	overdue: number;
	/** neverSynced + failing + overdue — the count the warning widget surfaces. */
	unhealthy: number;
}
