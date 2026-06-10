/**
 * Tiny, dependency-free sliding-window rate-limit core (Prompt 35). One instance holds a `Map` of
 * per-key counters; callers supply the `max` / `windowMs` bounds per call so a single core can back
 * several limiters with different limits. Used by the admin / end-user login and SAML SSO/SLO limiters.
 *
 * The map is pruned opportunistically (expired buckets evicted on access and on a periodic sweep) so a
 * flood of distinct keys — e.g. credential stuffing across many usernames or spoofed IPs — cannot grow
 * memory without bound. State is per-instance (per replica), as documented for the single-instance rule.
 */
export interface SlidingWindowResult {
	limited: boolean;
	/** Milliseconds until the current window rolls over (0 when not limited). */
	retryAfterMs: number;
}

interface Bucket {
	count: number;
	windowStartMs: number;
}

const NOT_LIMITED: SlidingWindowResult = { limited: false, retryAfterMs: 0 };
const PRUNE_INTERVAL_MS = 60_000;

export class SlidingWindowRateLimiter {
	private readonly buckets = new Map<string, Bucket>();
	private lastPruneMs = 0;

	/** Clock injection keeps window-rollover tests deterministic; defaults to the wall clock. */
	constructor(private readonly now: () => number = () => Date.now()) {}

	/** Read-only: is `key` currently at/over `max` within `windowMs`? Does not increment. */
	check(key: string, max: number, windowMs: number): SlidingWindowResult {
		const bucket = this.buckets.get(key);
		if (!bucket) {
			return NOT_LIMITED;
		}
		const now = this.now();
		const elapsed = now - bucket.windowStartMs;
		if (elapsed >= windowMs) {
			this.buckets.delete(key);
			return NOT_LIMITED;
		}
		if (bucket.count >= max) {
			return { limited: true, retryAfterMs: Math.max(0, windowMs - elapsed) };
		}
		return NOT_LIMITED;
	}

	/** Increment `key`'s counter within `windowMs` (starting a fresh window if the old one expired). */
	record(key: string, windowMs: number): void {
		const now = this.now();
		this.maybePrune(now, windowMs);
		const bucket = this.buckets.get(key);
		if (!bucket || now - bucket.windowStartMs >= windowMs) {
			this.buckets.set(key, { count: 1, windowStartMs: now });
			return;
		}
		bucket.count += 1;
	}

	/** Increment then report whether `key` is now at/over `max` — for callers that want both at once. */
	hit(key: string, max: number, windowMs: number): SlidingWindowResult {
		this.record(key, windowMs);
		return this.check(key, max, windowMs);
	}

	/** Current hit count for `key` within its live window (0 when absent/expired). Does not increment. */
	currentCount(key: string, windowMs: number): number {
		const bucket = this.buckets.get(key);
		if (!bucket || this.now() - bucket.windowStartMs >= windowMs) {
			return 0;
		}
		return bucket.count;
	}

	reset(key: string): void {
		this.buckets.delete(key);
	}

	clear(): void {
		this.buckets.clear();
	}

	/** Number of live buckets — used by the memory-safety test. */
	size(): number {
		return this.buckets.size;
	}

	/** Evict expired buckets at most once per {@link PRUNE_INTERVAL_MS} so access stays O(1) amortized. */
	private maybePrune(now: number, windowMs: number): void {
		if (now - this.lastPruneMs < PRUNE_INTERVAL_MS) {
			return;
		}
		this.lastPruneMs = now;
		for (const [key, bucket] of this.buckets) {
			if (now - bucket.windowStartMs >= windowMs) {
				this.buckets.delete(key);
			}
		}
	}
}
