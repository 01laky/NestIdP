import type { AuthType, LastSyncStatus } from './schema-enums.js';
import type { ApiContractConfig } from './api-contract.js';
import type { OAuthClientAuthMethod } from './oauth.js';

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
	// --- OAuth 2.0 Client Credentials (non-secret fields only) ---
	oauthTokenUrl: string | null;
	oauthClientId: string | null;
	oauthScope: string | null;
	oauthAudience: string | null;
	oauthClientAuthMethod: OAuthClientAuthMethod | null;
	oauthTokenRequestParams: Record<string, string> | null;
	/** True when an encrypted client secret is stored (the secret itself is never returned). */
	hasOauthClientSecret: boolean;
	/** Last successful token exchange (from the in-memory token cache), or null. */
	oauthLastTokenAt: string | null;
	lastSyncAt: string | null;
	lastSyncStatus: LastSyncStatus;
	createdAt: string;
	updatedAt: string;
}

/** OAuth config fields shared by create/update request DTOs (secret is write-only). */
export interface OAuthConnectionRequestFields {
	oauthTokenUrl?: string | null;
	oauthClientId?: string | null;
	/** Write-only: omit on update to keep the existing secret. */
	oauthClientSecret?: string | null;
	oauthScope?: string | null;
	oauthAudience?: string | null;
	oauthClientAuthMethod?: OAuthClientAuthMethod | null;
	oauthTokenRequestParams?: Record<string, string> | null;
}

export interface CreateApiConnectionRequestDto extends OAuthConnectionRequestFields {
	name: string;
	baseUrl: string;
	authType?: AuthType;
	/** Required when authType is BEARER (or omitted, which defaults to BEARER). */
	bearerToken?: string;
	apiContractConfig?: ApiContractConfig | null;
}

export interface UpdateApiConnectionRequestDto extends OAuthConnectionRequestFields {
	name?: string;
	baseUrl?: string;
	authType?: AuthType;
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
	/** OAuth token-endpoint diagnostics when authType is OAUTH2 (never includes the token). */
	tokenEndpoint?: OAuthTokenDiagnosticsDto;
}

/** Masked diagnostics from a token-endpoint exchange — never includes the access token or secret. */
export interface OAuthTokenDiagnosticsDto {
	ok: boolean;
	statusCode?: number;
	reachable: boolean;
	/** Echoed `token_type` from the token response, if present. */
	tokenType?: string;
	/** Clamped token lifetime in seconds that the cache will honour. */
	expiresIn?: number;
	/** Echoed `scope` granted by the authorization server, if present. */
	grantedScope?: string;
	/** Human-readable error (OAuth error/description or TLS/network reason), already redacted. */
	error?: string;
	/** True when the failure was a TLS/certificate problem (distinct from HTTP/network). */
	tlsError?: boolean;
}

/** Result of POST /api/admin/api-connections/:id/test-token — token exchange only. */
export type ApiConnectionTestTokenResponseDto = OAuthTokenDiagnosticsDto;

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
