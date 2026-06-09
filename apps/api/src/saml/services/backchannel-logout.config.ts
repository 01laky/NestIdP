import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * Bounded env config for back-channel (SOAP) SLO delivery (Prompt 36). Mirrors the bounded-int style of
 * the cert-rotation / sync schedulers. The retry scheduler tick `0` disables retries (synchronous-only).
 */
@Injectable()
export class BackchannelLogoutConfig {
	constructor(private readonly configService: ConfigService) {}

	/** Retry-scheduler tick; `0` disables the retry loop (only the synchronous first pass runs). */
	schedulerTickMs(): number {
		return this.boundedInt('SAML_BACKCHANNEL_LOGOUT_SCHEDULER_TICK_MS', 30_000, 0, HOUR);
	}

	httpTimeoutMs(): number {
		return this.boundedInt('SAML_BACKCHANNEL_LOGOUT_HTTP_TIMEOUT_MS', 5_000, 1_000, 60_000);
	}

	/** Max retry attempts after the first pass; `0` = first pass only. */
	maxRetries(): number {
		return this.boundedInt('SAML_BACKCHANNEL_LOGOUT_MAX_RETRIES', 5, 0, 50);
	}

	retryBaseMs(): number {
		return this.boundedInt('SAML_BACKCHANNEL_LOGOUT_RETRY_BASE_MS', 30_000, 1_000, DAY);
	}

	retryMaxMs(): number {
		return this.boundedInt('SAML_BACKCHANNEL_LOGOUT_RETRY_MAX_MS', HOUR, 1_000, DAY);
	}

	/** Max parallel deliveries per tick. */
	concurrency(): number {
		return this.boundedInt('SAML_BACKCHANNEL_LOGOUT_CONCURRENCY', 5, 1, 100);
	}

	/** Global cap on in-flight deliveries so a mass bulk-terminate cannot flood SPs. */
	maxInFlight(): number {
		return this.boundedInt('SAML_BACKCHANNEL_LOGOUT_MAX_INFLIGHT', 20, 1, 1000);
	}

	/** Wall-clock budget for the synchronous first pass; the rest falls to the retry queue. */
	firstPassBudgetMs(): number {
		return this.boundedInt('SAML_BACKCHANNEL_LOGOUT_FIRST_PASS_BUDGET_MS', 4_000, 0, 60_000);
	}

	/** Outbound LogoutRequest validity window (`NotOnOrAfter = IssueInstant + N`). */
	validitySeconds(): number {
		return this.boundedInt('SAML_BACKCHANNEL_LOGOUT_VALIDITY_S', 300, 30, 3_600);
	}

	/** Periodic prune of old succeeded/given_up rows; `0` disables. */
	pruneIntervalMs(): number {
		return this.boundedInt('SAML_BACKCHANNEL_LOGOUT_PRUNE_INTERVAL_MS', HOUR, 0, 7 * DAY);
	}

	/** Delete resolved rows older than this in the prune sweep. */
	pruneRetentionMs(): number {
		return this.boundedInt('SAML_BACKCHANNEL_LOGOUT_PRUNE_RETENTION_MS', 7 * DAY, MIN, 90 * DAY);
	}

	private boundedInt(key: string, fallback: number, min: number, max: number): number {
		const parsed = Number(this.configService.get<number | string>(key));
		if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
			return parsed;
		}
		return fallback;
	}
}
