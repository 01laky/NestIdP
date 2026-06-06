import type { AuthType, LastSyncStatus } from './schema-enums.js';
import type { ApiContractConfig } from './api-contract.js';

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
	/** Raw stored contract; null ⇒ the fixed v1 contract (round-trips the operator's input). */
	apiContractConfig: ApiContractConfig | null;
	lastSyncAt: string | null;
	lastSyncStatus: LastSyncStatus;
	createdAt: string;
	updatedAt: string;
}

export interface CreateApiConnectionRequestDto {
	name: string;
	baseUrl: string;
	bearerToken: string;
	apiContractConfig?: ApiContractConfig | null;
}

export interface UpdateApiConnectionRequestDto {
	name?: string;
	baseUrl?: string;
	/** Omit to keep existing token; provide non-empty string to rotate token */
	bearerToken?: string;
	/** Provide to set/replace; null clears back to the v1 default contract. */
	apiContractConfig?: ApiContractConfig | null;
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

/** A mapped user preview row in the test response — never includes a password hash. */
export interface ApiConnectionPreviewUserDto {
	id: string;
	username: string;
	email: string | null;
	displayName: string | null;
	active: boolean;
	passwordHashAlgorithm: string;
}

/** Result of POST /api/admin/api-connections/:id/test — connectivity + contract diagnostics. */
export interface ApiConnectionTestResponseDto {
	ok: boolean;
	statusCode?: number;
	reachable: boolean;
	message: string;
	/** Number of users parsed under the (resolved) contract, when reachable. */
	previewUsersCount?: number;
	/** First contract mapping/validation error (canonical field + source path), if any. */
	contractError?: string;
	/** First few mapped users (no passwordHash) for the operator to eyeball the mapping. */
	previewSample?: ApiConnectionPreviewUserDto[];
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
