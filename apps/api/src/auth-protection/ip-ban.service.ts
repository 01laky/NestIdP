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
/**
 * Soft cap on the number of tracked banned IPs. Once exceeded, expired bans are swept on the next trip
 * (§5.B14). Without this, a distributed attacker spraying distinct IPs — each banned once and never seen
 * again — would grow the `bans` map without bound (memory-growth DoS).
 */
const MAX_TRACKED_BANNED_IPS = 50_000;

@Injectable()
export class IpBanService {
	private readonly trips = new SlidingWindowRateLimiter();
	private readonly bans = new Map<string, number>();

	constructor(private readonly config: RateLimitConfig) {}

	/** Evict expired bans. Returns how many were removed. Called opportunistically + can be scheduled. */
	prune(now: number = Date.now()): number {
		let removed = 0;
		for (const [ip, until] of this.bans) {
			if (until <= now) {
				this.bans.delete(ip);
				removed += 1;
			}
		}
		return removed;
	}

	/** Is this IP currently banned? Run up-front, before throttle and password. */
	// §18: `now` is injectable so ban expiry can be tested against a fixed clock.
	check(ip: string, now: number = Date.now()): IpBanCheck {
		if (this.config.ipBanThreshold() === 0) {
			return { banned: false, retryAfterMs: 0 };
		}
		const until = this.bans.get(ip);
		if (until === undefined) {
			return { banned: false, retryAfterMs: 0 };
		}
		const remaining = until - now;
		if (remaining > 0) {
			return { banned: true, retryAfterMs: remaining };
		}
		this.bans.delete(ip);
		return { banned: false, retryAfterMs: 0 };
	}

	/** Record one "trip" (a throttle rejection or an account lockout) for this IP; ban if over threshold. */
	recordTrip(ip: string, now: number = Date.now()): IpBanTripResult {
		const threshold = this.config.ipBanThreshold();
		if (threshold === 0) {
			return { bannedNow: false, count: 0, bannedUntil: null };
		}
		const windowMs = this.config.ipBanWindowMs();
		const { limited } = this.trips.hit(ip, threshold, windowMs);
		// §5.C: report the real observed trip count, not the configured threshold — the audit row must say
		// how many trips this IP actually accumulated.
		const count = this.trips.currentCount(ip, windowMs);
		if (!limited) {
			return { bannedNow: false, count, bannedUntil: null };
		}
		const alreadyBanned = (this.bans.get(ip) ?? 0) > now;
		// §5.B14: bound the map — sweep expired bans once it grows past the soft cap.
		if (this.bans.size >= MAX_TRACKED_BANNED_IPS) {
			this.prune(now);
		}
		const bannedUntil = new Date(now + this.config.ipBanMs());
		this.bans.set(ip, bannedUntil.getTime());
		// `bannedNow` only on the transition into banned, so audit/notify is de-duped under a flood.
		return { bannedNow: !alreadyBanned, count, bannedUntil };
	}

	clear(): void {
		this.bans.clear();
		this.trips.clear();
	}
}
