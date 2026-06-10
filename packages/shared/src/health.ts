/** Per-scheduler liveness gauge: when the last tick finished and how much work it processed. */
export interface SchedulerTickStats {
	/** ISO timestamp of the last completed tick; null before the first tick. */
	lastTickAt: string | null;
	/** Work units handled by the last tick (rows / connections / cert kinds); null before the first tick. */
	lastProcessed: number | null;
}

export interface HealthSchedulers {
	backchannel: SchedulerTickStats;
	sync: SchedulerTickStats;
	certRotation: SchedulerTickStats;
}

/** In-process audit persistence failure signal (audit_persist_failed is otherwise swallowed). */
export interface HealthAuditStats {
	persistFailures: number;
	lastPersistFailureAt: string | null;
}

export interface HealthResponse {
	status: 'ok';
	service: 'nest-idp-api';
	/** App version (npm_package_version, falling back to the api package.json); null if unresolvable. */
	version: string | null;
	/** Git commit injected at build time via BUILD_GIT_SHA; null when not provided. */
	gitSha: string | null;
	uptimeSeconds: number;
	audit: HealthAuditStats;
	schedulers: HealthSchedulers;
}

/** Migration progress: applied (tracking table) vs available (migration dirs on disk). */
export interface ReadyMigrations {
	applied: number;
	available: number;
	upToDate: boolean;
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
	/** Migration progress (present when the DB is reachable). */
	migrations?: ReadyMigrations;
	/** Present only when an external identity database is configured (Prompt 31). */
	externalIdentityDb?: ReadyExternalIdentityDb;
	/** Scheduler state (Prompt 32); present when the DB is reachable. */
	scheduler?: ReadyScheduler;
}

export interface ReadyCheckResult {
	httpStatus: 200 | 503;
	body: ReadyResponse;
}
