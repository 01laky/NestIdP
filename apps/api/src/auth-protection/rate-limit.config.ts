import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseNoProxyHosts } from '@nestidp/shared';
import { boundedInt as boundedIntFromRaw } from '../common/config/bounded-int.util';
import type { LoginScope } from './brute-force-notifier';

export type LoginLockoutResponseMode = 'retry_after' | 'opaque';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;

/**
 * Bounded env config for the brute-force protection layer (Prompt 35). Mirrors the bounded-int style of
 * {@link CertRotationConfig}. Per-scope lockout knobs (`ADMIN_…` / `END_USER_…`) fall back to the shared
 * `LOGIN_LOCKOUT_…` value. Every limit/window has a safe default so a missing or out-of-range value can
 * never weaken protection silently.
 */
@Injectable()
export class RateLimitConfig {
	constructor(private readonly configService: ConfigService) {}

	// --- Account lockout ------------------------------------------------------------------------

	/** Consecutive failures before the first lock; `0` disables the lockout layer for this scope. */
	lockoutThreshold(scope: LoginScope): number {
		return this.scoped(scope, 'LOGIN_LOCKOUT_THRESHOLD', 5, 0, 1000);
	}

	/** First lock duration; backoff doubles per extra failure up to {@link lockoutMaxMs}. */
	lockoutBaseMs(scope: LoginScope): number {
		return this.scoped(scope, 'LOGIN_LOCKOUT_BASE_MS', FIFTEEN_MIN_MS, 1000, 30 * DAY_MS);
	}

	lockoutMaxMs(scope: LoginScope): number {
		return this.scoped(scope, 'LOGIN_LOCKOUT_MAX_MS', DAY_MS, 1000, 30 * DAY_MS);
	}

	/** Periodic sweep interval for the `LoginLockout` table; `0` disables the sweep. */
	lockoutPruneIntervalMs(): number {
		return this.boundedInt('LOGIN_LOCKOUT_PRUNE_INTERVAL_MS', HOUR_MS, 0, 7 * DAY_MS);
	}

	responseMode(): LoginLockoutResponseMode {
		const raw = String(this.configService.get('LOGIN_LOCKOUT_RESPONSE_MODE') ?? '').toLowerCase();
		return raw === 'opaque' ? 'opaque' : 'retry_after';
	}

	// --- Admin login throttle (configurable + per-username, parity with end-user) ----------------

	adminIpMax(): number {
		return this.boundedInt('ADMIN_LOGIN_RATE_LIMIT_MAX', 10, 1, 100_000);
	}
	adminIpWindowMs(): number {
		return this.boundedInt('ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS', FIFTEEN_MIN_MS, 1000, DAY_MS);
	}
	adminUsernameMax(): number {
		return this.boundedInt('ADMIN_LOGIN_RATE_LIMIT_USERNAME_MAX', 5, 1, 100_000);
	}
	adminUsernameWindowMs(): number {
		return this.boundedInt(
			'ADMIN_LOGIN_RATE_LIMIT_USERNAME_WINDOW_MS',
			FIFTEEN_MIN_MS,
			1000,
			DAY_MS,
		);
	}

	// --- End-user login throttle (preserves the pre-existing END_USER_LOGIN_RATE_LIMIT_* env keys) -

	endUserIpMax(): number {
		return this.boundedInt('END_USER_LOGIN_RATE_LIMIT_MAX', 10, 1, 100_000);
	}
	endUserIpWindowMs(): number {
		return this.boundedInt('END_USER_LOGIN_RATE_LIMIT_WINDOW_MS', FIFTEEN_MIN_MS, 1000, DAY_MS);
	}
	endUserUsernameMax(): number {
		return this.boundedInt('END_USER_LOGIN_RATE_LIMIT_USERNAME_MAX', 5, 1, 100_000);
	}
	endUserUsernameWindowMs(): number {
		return this.boundedInt(
			'END_USER_LOGIN_RATE_LIMIT_USERNAME_WINDOW_MS',
			FIFTEEN_MIN_MS,
			1000,
			DAY_MS,
		);
	}

	/** Per-scope IP throttle bounds. */
	loginIpMax(scope: LoginScope): number {
		return scope === 'admin' ? this.adminIpMax() : this.endUserIpMax();
	}
	loginIpWindowMs(scope: LoginScope): number {
		return scope === 'admin' ? this.adminIpWindowMs() : this.endUserIpWindowMs();
	}
	loginUsernameMax(scope: LoginScope): number {
		return scope === 'admin' ? this.adminUsernameMax() : this.endUserUsernameMax();
	}
	loginUsernameWindowMs(scope: LoginScope): number {
		return scope === 'admin' ? this.adminUsernameWindowMs() : this.endUserUsernameWindowMs();
	}

	// --- SAML SSO throttle (closes the unthrottled-endpoint gap) ---------------------------------

	ssoIpMax(): number {
		return this.boundedInt('SAML_SSO_RATE_IP_MAX', 60, 1, 1_000_000);
	}
	ssoWindowMs(): number {
		return this.boundedInt('SAML_SSO_RATE_WINDOW_MS', FIFTEEN_MIN_MS, 1000, DAY_MS);
	}

	// --- Cross-endpoint per-IP escalation / ban --------------------------------------------------

	/** Distinct lockouts/throttle-trips from one IP within the window before a ban; `0` disables. */
	ipBanThreshold(): number {
		return this.boundedInt('LOGIN_IP_BAN_THRESHOLD', 10, 0, 1_000_000);
	}
	ipBanWindowMs(): number {
		return this.boundedInt('LOGIN_IP_BAN_WINDOW_MS', FIFTEEN_MIN_MS, 1000, DAY_MS);
	}
	ipBanMs(): number {
		return this.boundedInt('LOGIN_IP_BAN_MS', HOUR_MS, 1000, 30 * DAY_MS);
	}

	// --- Trusted bypass + tarpit -----------------------------------------------------------------

	/** CIDRs/IPs exempt from the IP throttle and IP ban (never from account lockout). */
	trustedCidrs(): string[] {
		return parseNoProxyHosts(this.configService.get<string>('RATE_LIMIT_TRUSTED_CIDRS'));
	}

	/** Incremental delay before a failed-login response; `0` disables the tarpit. */
	tarpitBaseMs(): number {
		return this.boundedInt('LOGIN_TARPIT_BASE_MS', 0, 0, 5000);
	}

	// --- helpers ---------------------------------------------------------------------------------

	/** Per-scope override (`ADMIN_…` / `END_USER_…`) falling back to the shared `key`. */
	private scoped(
		scope: LoginScope,
		key: string,
		fallback: number,
		min: number,
		max: number,
	): number {
		const prefix = scope === 'admin' ? 'ADMIN_' : 'END_USER_';
		const override = this.optionalInt(`${prefix}${key}`, min, max);
		return override ?? this.boundedInt(key, fallback, min, max);
	}

	private boundedInt(key: string, fallback: number, min: number, max: number): number {
		// §6.1: delegate to the shared helper (adds correct empty-string handling).
		return boundedIntFromRaw(this.configService.get<number | string>(key), fallback, min, max);
	}

	private optionalInt(key: string, min: number, max: number): number | null {
		const raw = this.configService.get<number | string>(key);
		if (raw === undefined || raw === null || raw === '') {
			return null;
		}
		const parsed = Number(raw);
		if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
			return parsed;
		}
		return null;
	}
}
