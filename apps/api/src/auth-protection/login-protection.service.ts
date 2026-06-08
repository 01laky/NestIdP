import {
	HttpException,
	HttpStatus,
	Inject,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ipMatchesCidrList } from '@nestidp/shared';
import { SlidingWindowRateLimiter } from '../common/rate-limit/sliding-window-rate-limiter';
import { AccountLockoutService } from './account-lockout.service';
import { AuthProtectionAuditService } from './auth-protection-audit.service';
import {
	BRUTE_FORCE_NOTIFIER,
	type BruteForceNotifier,
	type LoginScope,
} from './brute-force-notifier';
import { IpBanService } from './ip-ban.service';
import { RateLimitConfig } from './rate-limit.config';

/**
 * Why an attempt is being blocked. `lockout` carries a `retryAfterMs`; the others may too. The reason is
 * for audit/logging only — it is never exposed in the HTTP response (no enumeration).
 */
export type BlockReason = 'ip_banned' | 'ip_throttle' | 'username_throttle' | 'lockout';

export interface PrecheckResult {
	allowed: boolean;
	reason?: BlockReason;
	retryAfterMs: number;
}

/**
 * Central brute-force protection orchestrator (Prompt 35). Unifies the three dimensions behind one
 * sliding-window core: per-IP / per-username throttle, persistent per-account lockout, and cross-endpoint
 * per-IP escalation/ban — plus an optional tarpit and the configurable response disclosure mode. Called
 * by the admin + end-user login paths and (IP-only) by the SAML SSO endpoint.
 */
@Injectable()
export class LoginProtectionService {
	private readonly throttle: SlidingWindowRateLimiter;

	constructor(
		private readonly config: RateLimitConfig,
		private readonly lockout: AccountLockoutService,
		private readonly ipBan: IpBanService,
		private readonly audit: AuthProtectionAuditService,
		@Inject(BRUTE_FORCE_NOTIFIER) private readonly notifier: BruteForceNotifier,
	) {
		this.throttle = new SlidingWindowRateLimiter();
	}

	/** Full pre-password check for an admin/end-user login: IP ban → IP throttle → username throttle → lockout. */
	async precheckLogin(
		scope: LoginScope,
		usernameKey: string,
		clientIp: string,
	): Promise<PrecheckResult> {
		const trusted = this.isTrusted(clientIp);

		if (!trusted) {
			const ban = this.ipBan.check(clientIp);
			if (ban.banned) {
				return this.blocked(scope, clientIp, 'ip_banned', ban.retryAfterMs);
			}
			const ipKey = `ip:${scope}:${clientIp}`;
			const ipHit = this.throttle.check(
				ipKey,
				this.config.loginIpMax(scope),
				this.config.loginIpWindowMs(scope),
			);
			if (ipHit.limited) {
				this.audit.logRateLimited(scope, clientIp, 'ip', ipHit.retryAfterMs, usernameKey);
				this.recordTrip(scope, clientIp);
				return this.result(false, 'ip_throttle', ipHit.retryAfterMs);
			}
			const unKey = `un:${scope}:${usernameKey}`;
			const unHit = this.throttle.check(
				unKey,
				this.config.loginUsernameMax(scope),
				this.config.loginUsernameWindowMs(scope),
			);
			if (unHit.limited) {
				this.audit.logRateLimited(scope, clientIp, 'username', unHit.retryAfterMs, usernameKey);
				this.recordTrip(scope, clientIp);
				return this.result(false, 'username_throttle', unHit.retryAfterMs);
			}
		}

		// Account lockout always applies — a trusted network must not become a single-account oracle.
		const lock = await this.lockout.check(scope, usernameKey, new Date());
		if (lock.locked) {
			this.recordTrip(scope, clientIp);
			return this.result(false, 'lockout', lock.retryAfterMs);
		}
		return this.result(true);
	}

	/** IP-only pre-check for the SAML SSO endpoint (no account, no lockout). */
	precheckSso(clientIp: string): PrecheckResult {
		if (this.isTrusted(clientIp)) {
			return this.result(true);
		}
		const ban = this.ipBan.check(clientIp);
		if (ban.banned) {
			this.audit.logRateLimited('sso', clientIp, 'ip', ban.retryAfterMs);
			return this.result(false, 'ip_banned', ban.retryAfterMs);
		}
		const ipKey = `ip:sso:${clientIp}`;
		const windowMs = this.config.ssoWindowMs();
		const hit = this.throttle.check(ipKey, this.config.ssoIpMax(), windowMs);
		if (hit.limited) {
			this.audit.logRateLimited('sso', clientIp, 'ip', hit.retryAfterMs);
			this.recordTrip('sso', clientIp);
			return this.result(false, 'ip_throttle', hit.retryAfterMs);
		}
		this.throttle.record(ipKey, windowMs);
		return this.result(true);
	}

	/** Record a failed login: bump throttle counters, the lockout counter (locking if over threshold), tarpit. */
	async recordLoginFailure(
		scope: LoginScope,
		usernameKey: string,
		clientIp: string,
	): Promise<void> {
		this.throttle.record(`ip:${scope}:${clientIp}`, this.config.loginIpWindowMs(scope));
		this.throttle.record(`un:${scope}:${usernameKey}`, this.config.loginUsernameWindowMs(scope));

		const result = await this.lockout.recordFailure(scope, usernameKey, new Date());
		if (result.lockedNow) {
			this.audit.logAccountLocked(
				scope,
				usernameKey,
				clientIp,
				result.failedCount,
				result.lockedUntil,
			);
			await this.notifier.onAccountLocked({
				scope,
				usernameKey,
				clientIp,
				count: result.failedCount,
				until: result.lockedUntil?.toISOString() ?? null,
			});
			this.recordTrip(scope, clientIp);
		}
		await this.applyTarpit(result.failedCount);
	}

	/** Record a successful login: reset that account's throttle + lockout. */
	async recordLoginSuccess(
		scope: LoginScope,
		usernameKey: string,
		clientIp: string,
	): Promise<void> {
		this.throttle.reset(`ip:${scope}:${clientIp}`);
		this.throttle.reset(`un:${scope}:${usernameKey}`);
		await this.lockout.recordSuccess(scope, usernameKey);
	}

	isTrusted(clientIp: string): boolean {
		return ipMatchesCidrList(clientIp, this.config.trustedCidrs());
	}

	/** Reset all in-memory throttle + IP-ban state (used by tests between runs; lockout lives in the DB). */
	clear(): void {
		this.throttle.clear();
		this.ipBan.clear();
	}

	/**
	 * Enforce a blocked precheck on the HTTP layer honouring the response mode. `retry_after` (default)
	 * sets `Retry-After` and throws `429`; `opaque` throws the same generic `401` as a wrong password so a
	 * locked/throttled account is indistinguishable from bad credentials (no enumeration). Never returns.
	 */
	enforceBlock(result: PrecheckResult, res?: Response): never {
		if (this.config.responseMode() === 'opaque') {
			throw new UnauthorizedException('Invalid credentials');
		}
		if (res && result.retryAfterMs > 0) {
			res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
		}
		throw new HttpException('Too many login attempts', HttpStatus.TOO_MANY_REQUESTS);
	}

	private recordTrip(surface: LoginScope | 'sso', clientIp: string): void {
		if (this.isTrusted(clientIp)) {
			return;
		}
		const trip = this.ipBan.recordTrip(clientIp);
		if (trip.bannedNow) {
			this.audit.logIpBanned(surface, clientIp, trip.count, trip.bannedUntil);
			void this.notifier.onIpBanned({
				scope: surface === 'sso' ? 'end_user' : surface,
				clientIp,
				count: trip.count,
				until: trip.bannedUntil?.toISOString() ?? null,
			});
		}
	}

	private blocked(
		scope: LoginScope,
		clientIp: string,
		reason: BlockReason,
		retryAfterMs: number,
	): PrecheckResult {
		this.audit.logRateLimited(scope, clientIp, 'ip', retryAfterMs);
		return this.result(false, reason, retryAfterMs);
	}

	private async applyTarpit(failedCount: number): Promise<void> {
		const base = this.config.tarpitBaseMs();
		if (base <= 0 || failedCount <= 0) {
			return;
		}
		const delay = Math.min(base * failedCount, 5000);
		await new Promise((resolve) => setTimeout(resolve, delay));
	}

	private result(allowed: boolean, reason?: BlockReason, retryAfterMs = 0): PrecheckResult {
		return { allowed, reason, retryAfterMs };
	}
}
