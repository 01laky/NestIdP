import type { AuthType, LastSyncStatus } from './schema-enums.js';

/** Admin REST API base path for API connection CRUD (not the React route). */
export const API_CONNECTIONS_API_PATH = '/api/admin/api-connections';

/** React admin UI route prefix (Prompt 08). */
export const API_CONNECTION_ROUTE_PREFIX = '/admin/api-connections';

export const SP_CONNECTION_ROUTE_PREFIX = '/admin/sp-connections';

/** Public API connection (never includes secrets). */
export interface ApiConnectionDto {
	id: string;
	name: string;
	baseUrl: string;
	authType: AuthType;
	hasBearerToken: boolean;
	lastSyncAt: string | null;
	lastSyncStatus: LastSyncStatus;
	createdAt: string;
	updatedAt: string;
}

export interface CreateApiConnectionRequestDto {
	name: string;
	baseUrl: string;
	bearerToken: string;
}

export interface UpdateApiConnectionRequestDto {
	name?: string;
	baseUrl?: string;
	/** Omit to keep existing token; provide non-empty string to rotate token */
	bearerToken?: string;
}

export interface ApiConnectionListResponseDto {
	connections: ApiConnectionDto[];
}

export interface ApiConnectionResponseDto {
	connection: ApiConnectionDto;
}

export interface DeleteApiConnectionResponseDto {
	ok: true;
	id: string;
}

/** Result of POST /api/admin/api-connections/:id/test — connectivity probe only. */
export interface ApiConnectionTestResponseDto {
	ok: boolean;
	statusCode?: number;
	reachable: boolean;
	message: string;
}

/** @deprecated Use ApiConnectionDto */
export type ApiConnectionStubDto = ApiConnectionDto;

/** Stub DTO for SP connection (SAML application) — full CRUD in a later prompt. */
export interface SpConnectionStubDto {
	id?: string;
	name: string;
	spEntityId: string;
	acsUrl: string;
	nameIdFormat?: string;
	active?: boolean;
}
