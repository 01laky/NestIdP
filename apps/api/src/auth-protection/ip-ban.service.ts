import { Injectable } from '@nestjs/common';
import { SlidingWindowRateLimiter } from '../common/rate-limit/sliding-window-rate-limiter';
import { RateLimitConfig } from './rate-limit.config';

export interface IpBanCheck {
	banned: boolean;
	retryAfterMs: number;
}

export interface IpBanTripResult {
	bannedNow: boolean;
	count: number;
	bannedUntil: Date | null;
}

/**
 * Cross-endpoint per-IP escalation (Prompt 35): counts an IP's distinct lockouts + throttle rejections
 * across admin login, end-user login, and SAML SSO within a window; once the count crosses the threshold
 * the IP is banned wholesale for a bounded duration. Catches the distributed attacker that stays under
 * any single account/window. In-memory (per instance), time-bounded — never a permanent ban. Threshold
 * `0` disables the layer entirely.
 */
@Injectable()
export class IpBanService {
	private readonly trips = new SlidingWindowRateLimiter();
	private readonly bans = new Map<string, number>();

	constructor(private readonly config: RateLimitConfig) {}

	/** Is this IP currently banned? Run up-front, before throttle and password. */
	check(ip: string): IpBanCheck {
		if (this.config.ipBanThreshold() === 0) {
			return { banned: false, retryAfterMs: 0 };
		}
		const until = this.bans.get(ip);
		if (until === undefined) {
			return { banned: false, retryAfterMs: 0 };
		}
		const remaining = until - Date.now();
		if (remaining > 0) {
			return { banned: true, retryAfterMs: remaining };
		}
		this.bans.delete(ip);
		return { banned: false, retryAfterMs: 0 };
	}

	/** Record one "trip" (a throttle rejection or an account lockout) for this IP; ban if over threshold. */
	recordTrip(ip: string): IpBanTripResult {
		const threshold = this.config.ipBanThreshold();
		if (threshold === 0) {
			return { bannedNow: false, count: 0, bannedUntil: null };
		}
		const windowMs = this.config.ipBanWindowMs();
		const { limited } = this.trips.hit(ip, threshold, windowMs);
		if (!limited) {
			return { bannedNow: false, count: threshold, bannedUntil: null };
		}
		const alreadyBanned = (this.bans.get(ip) ?? 0) > Date.now();
		const bannedUntil = new Date(Date.now() + this.config.ipBanMs());
		this.bans.set(ip, bannedUntil.getTime());
		// `bannedNow` only on the transition into banned, so audit/notify is de-duped under a flood.
		return { bannedNow: !alreadyBanned, count: threshold, bannedUntil };
	}

	clear(): void {
		this.bans.clear();
		this.trips.clear();
	}
}
