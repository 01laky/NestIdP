import type { AuthType, LastSyncStatus } from './schema-enums.js';

/** Stub DTO for API connection (identity source) — full CRUD in a later prompt. */
export interface ApiConnectionStubDto {
	id?: string;
	name: string;
	baseUrl: string;
	authType?: AuthType;
	lastSyncAt?: string | null;
	lastSyncStatus?: LastSyncStatus;
}

/** Stub DTO for SP connection (SAML application) — full CRUD in a later prompt. */
export interface SpConnectionStubDto {
	id?: string;
	name: string;
	spEntityId: string;
	acsUrl: string;
	nameIdFormat?: string;
	active?: boolean;
}

export const API_CONNECTION_ROUTE_PREFIX = '/admin/api-connections';
export const SP_CONNECTION_ROUTE_PREFIX = '/admin/sp-connections';
