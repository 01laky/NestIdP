/** HTTP-only cookie name for end-user (synced identity) sessions. */
export const END_USER_SESSION_COOKIE_NAME = 'nestidp_user_session';

/** End-user REST API base path (not the React /login route). */
export const AUTH_API_PATH = '/api/auth';

/** React SAML login page route (SPA). */
export const LOGIN_PAGE_ROUTE = '/login';

/**
 * Query param name for pending SAML session id on login page.
 * Prompt 07 redirects: `${LOGIN_PAGE_ROUTE}?${SAML_SESSION_QUERY_PARAM}=<cuid>`
 */
export const SAML_SESSION_QUERY_PARAM = 'samlSessionId';

/** POST body field — same string value as SAML_SESSION_QUERY_PARAM. */
export const SAML_SESSION_BODY_FIELD = 'samlSessionId';

/** Nest injection token for SAML session bind (Prompt 07 imports without AuthModule cycle). */
export const SAML_SESSION_BIND_PORT = 'SAML_SESSION_BIND_PORT';

/** Port implemented by SamlSessionBindService in AuthModule. */
export interface SamlSessionBindPort {
	bindUserToSession(samlSessionId: string, userId: string): Promise<void>;
}

/** Public user profile — never includes passwordHash or apiConnectionId. */
export interface EndUserPublicDto {
	id: string;
	username: string;
	email: string | null;
	displayName: string | null;
	groups: string[];
	roles: string[];
}

export interface EndUserLoginRequestDto {
	username: string;
	password: string;
	samlSessionId?: string;
}

export interface EndUserLoginResponseDto {
	ok: true;
	user: EndUserPublicDto;
	samlSessionBound: boolean;
}

export interface EndUserMeResponseDto {
	user: EndUserPublicDto;
}

export interface EndUserLogoutResponseDto {
	ok: true;
}

export interface EndUserSessionStatusResponseDto {
	authenticated: boolean;
	user: EndUserPublicDto | null;
	samlSession: {
		id: string;
		bound: boolean;
		expired: boolean;
		spActive: boolean;
	} | null;
}

export interface CompleteSsoNotImplementedResponseDto {
	status: 'not_implemented';
	message: string;
	samlSessionId: string;
}
