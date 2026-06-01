import type { ApiConnectionDto } from './connections.js';
import type { LastSyncStatus } from './schema-enums.js';

export interface AdminStatsDto {
	users: number;
	groups: number;
	roles: number;
	apiConnections: number;
	spConnections: number;
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
	apiConnection: ApiConnectionDto | null;
	lastSyncStatus: LastSyncStatus | null;
	lastSyncAt: string | null;
}

/** @deprecated Use AdminDashboardResponseDto */
export type AdminStubResponseDto = AdminDashboardResponseDto;
