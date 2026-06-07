export interface HealthResponse {
	status: 'ok';
	service: 'nest-idp-api';
}

export interface ReadyExternalIdentityDb {
	status: string;
	mode: string;
	reachable: boolean;
	outOfSync: boolean;
}

export interface ReadyResponse {
	status: 'ok' | 'unavailable';
	service: 'nest-idp-api';
	database: 'connected' | 'disconnected' | 'not_configured';
	/** Number of applied schema migrations (present when the DB is reachable). */
	migrations?: number;
	/** Present only when an external identity database is configured (Prompt 31). */
	externalIdentityDb?: ReadyExternalIdentityDb;
}

export interface ReadyCheckResult {
	httpStatus: 200 | 503;
	body: ReadyResponse;
}
