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

/** Back-channel (SOAP) LogoutRequest delivery status to one SP (Prompt 36). */
export type BackchannelLogoutStatus =
	| 'pending'
	| 'in_flight'
	| 'succeeded'
	| 'partial'
	| 'failed'
	| 'given_up'
	| 'skipped_no_endpoint';

export interface SamlBackchannelLogoutPublicDto {
	spConnectionId: string;
	spName: string;
	status: BackchannelLogoutStatus;
	attempts: number;
	lastError: string | null;
	lastAttemptAt: string | null;
	nextRetryAt: string | null;
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
	/** Per-SP back-channel logout delivery state (Prompt 36); present from v1.17.0. */
	backchannelLogouts?: SamlBackchannelLogoutPublicDto[];
}

// --- Back-channel SLO propagation port (Prompt 36) ---------------------------------------------

/** Nest injection token — implemented by the back-channel module; Noop default in the registry module. */
export const LOGOUT_PROPAGATION_PORT = 'LOGOUT_PROPAGATION_PORT';

export interface LogoutPropagationInput {
	ssoSessionId: string;
	reason: SamlSsoSessionTerminationReason;
	/** SP to exclude — the initiator on an SP-initiated SLO (it gets the front-channel response instead). */
	excludeSpConnectionId?: string;
}

/** Decoupled hook the session registry calls on terminate; default Noop keeps local-only behaviour. */
export interface LogoutPropagationPort {
	propagateLogout(input: LogoutPropagationInput): Promise<void>;
}

/** Options for SamlSsoSessionService.terminate (Prompt 36). */
export interface TerminateSessionOptions {
	actorAdminId?: string;
	excludeSpConnectionId?: string;
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

// --- Bulk / kill-switch / back-channel ops (Prompt 36) -----------------------------------------

export type BulkTerminateOutcome = 'terminated' | 'already_terminated' | 'not_found';

export interface TerminateSamlSessionsBulkRequestDto {
	ids: string[];
}

export interface TerminateSamlSessionsBulkResponseDto {
	ok: true;
	results: { id: string; outcome: BulkTerminateOutcome }[];
	terminatedCount: number;
}

export interface TerminateAllSamlSessionsResponseDto {
	ok: true;
	terminatedCount: number;
}

export interface ResendBackchannelLogoutResponseDto {
	ok: true;
	ssoSessionId: string;
	spConnectionId: string;
}

export interface ProcessBackchannelResponseDto {
	ok: true;
	processed: number;
}

export interface SamlBackchannelQueueHealthDto {
	pending: number;
	inFlight: number;
	succeeded: number;
	partial: number;
	failed: number;
	givenUp: number;
	skipped: number;
}

/** Result of the SP-form "Test back-channel SLO" probe (Prompt 36, item S). */
export interface TestSpBackchannelSloResponseDto {
	ok: boolean;
	reason?: string;
}
