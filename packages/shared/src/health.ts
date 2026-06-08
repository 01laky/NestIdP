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

/** Scheduler liveness summary surfaced in /ready so an operator can confirm scheduling is alive. */
export interface ReadyScheduler {
	/** True when the in-process tick is enabled (SYNC_SCHEDULER_TICK_MS > 0). */
	enabled: boolean;
	/** Connections with scheduleEnabled = true (paused or not). */
	scheduledConnections: number;
	/** Enabled, non-paused connections whose nextRunAt <= now (will run on the next tick). */
	due: number;
}

export interface ReadyResponse {
	status: 'ok' | 'unavailable';
	service: 'nest-idp-api';
	database: 'connected' | 'disconnected' | 'not_configured';
	/** Number of applied schema migrations (present when the DB is reachable). */
	migrations?: number;
	/** Present only when an external identity database is configured (Prompt 31). */
	externalIdentityDb?: ReadyExternalIdentityDb;
	/** Scheduler state (Prompt 32); present when the DB is reachable. */
	scheduler?: ReadyScheduler;
}

export interface ReadyCheckResult {
	httpStatus: 200 | 503;
	body: ReadyResponse;
}
