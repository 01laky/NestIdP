import type { ApiConnectionDto } from './connections.js';
import type { LastSyncStatus } from './schema-enums.js';
import type { AdminDashboardIdpCertStatus } from './idp-settings.js';

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
	certStatus: AdminDashboardIdpCertStatus;
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
	apiConnection: ApiConnectionDto | null;
	lastSyncStatus: LastSyncStatus | null;
	lastSyncAt: string | null;
}

/** @deprecated Use AdminDashboardResponseDto */
export type AdminStubResponseDto = AdminDashboardResponseDto;
