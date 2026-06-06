/** SAML Single Logout (SLO) + admin active-session shared contracts (v1.8.0). */

/** Admin REST — active SSO session management. */
export const SAML_SESSIONS_API_PATH = '/api/admin/saml-sessions';

/** Admin SPA route for the Active Sessions page. */
export const SAML_SESSIONS_ROUTE_PREFIX = '/admin/sessions';

/** SPA route shown after a front-channel logout when the SP has no SLO endpoint. */
export const LOGGED_OUT_ROUTE = '/logged-out';

/** SAML 2.0 status codes used by LogoutResponse. */
export const SAML_STATUS_SUCCESS = 'urn:oasis:names:tc:SAML:2.0:status:Success';
export const SAML_STATUS_RESPONDER = 'urn:oasis:names:tc:SAML:2.0:status:Responder';
export const SAML_STATUS_REQUEST_DENIED = 'urn:oasis:names:tc:SAML:2.0:status:RequestDenied';
export const SAML_STATUS_PARTIAL_LOGOUT = 'urn:oasis:names:tc:SAML:2.0:status:PartialLogout';

export type SamlLogoutBindingType = 'redirect' | 'post';

export type SamlSsoSessionStatus = 'active' | 'terminated';

export type SamlSsoSessionTerminationReason =
	| 'admin_action'
	| 'sp_logout'
	| 'user_logout'
	| 'user_deactivated';

export interface SamlSpParticipationPublicDto {
	id: string;
	spConnectionId: string;
	spName: string;
	spEntityId: string;
	sessionIndex: string;
	nameId: string;
	nameIdFormat: string;
	createdAt: string;
}

export interface SamlSsoSessionPublicDto {
	id: string;
	userId: string | null;
	username: string;
	createdAt: string;
	lastSeenAt: string;
	expiresAt: string;
	loginIp: string | null;
	userAgent: string | null;
	lastSeenIp: string | null;
	status: SamlSsoSessionStatus;
	terminatedAt: string | null;
	terminatedReason: SamlSsoSessionTerminationReason | null;
	participations: SamlSpParticipationPublicDto[];
}

export type SamlSsoSessionStatusFilter = 'active' | 'terminated' | 'all';

export const SAML_SESSIONS_LIST_PAGE_SIZE = 10 as const;

export interface SamlSsoSessionListQueryDto {
	status?: SamlSsoSessionStatusFilter;
	spConnectionId?: string;
	q?: string;
	page?: number;
	pageSize?: number;
}

export interface SamlSsoSessionListResponseDto {
	items: SamlSsoSessionPublicDto[];
	total: number;
}

export interface TerminateSamlSessionResponseDto {
	ok: true;
	id: string;
	alreadyTerminated: boolean;
}

export interface TerminateSamlSessionsByUserRequestDto {
	userId: string;
}

export interface TerminateSamlSessionsByUserResponseDto {
	ok: true;
	userId: string;
	terminatedCount: number;
}
