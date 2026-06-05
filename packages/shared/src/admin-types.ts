import type { ApiConnectionDto } from './connections.js';
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
	signingKeyFamily: 'rsa' | 'ec' | null;
	signingSignatureAlgorithmId: string | null;
	signingRsaModulusBits: number | null;
	signingEcCurve: string | null;
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
}

export interface AdminDashboardResponseDto {
	counts: AdminStatsDto;
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
	apiConnection: ApiConnectionDto | null;
	lastSyncStatus: LastSyncStatus | null;
	lastSyncAt: string | null;
	auditEventsRoute: typeof AUDIT_ROUTE_PREFIX;
	adminUsersRoute: typeof ADMIN_USERS_ROUTE_PREFIX;
}

/** @deprecated Use AdminDashboardResponseDto */
export type AdminStubResponseDto = AdminDashboardResponseDto;
