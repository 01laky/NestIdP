import type { IdentityStore } from '../identity-store';

export type BreakerState = 'closed' | 'open' | 'half-open';

/**
 * Minimal circuit breaker: after `threshold` consecutive failures it opens for `cooldownMs`,
 * failing fast so a dead external database cannot pile up requests on login/SAML. After the cooldown
 * it half-opens and the next call probes; success closes it.
 */
export class CircuitBreaker {
	private failures = 0;
	private openUntil = 0;

	constructor(
		private readonly threshold = 5,
		private readonly cooldownMs = 10_000,
	) {}

	get state(): BreakerState {
		if (Date.now() < this.openUntil) {
			return 'open';
		}
		// Half-open is the genuine probe state only: the breaker tripped (openUntil was set) and the
		// cooldown elapsed without a success (success resets openUntil to 0). Failures below the
		// threshold never trip the breaker, so they still report 'closed'.
		return this.openUntil > 0 ? 'half-open' : 'closed';
	}

	async exec<T>(fn: () => Promise<T>): Promise<T> {
		if (Date.now() < this.openUntil) {
			throw new Error('circuit_open: external identity database is unavailable');
		}
		try {
			const result = await fn();
			this.failures = 0;
			this.openUntil = 0;
			return result;
		} catch (error) {
			this.failures += 1;
			if (this.failures >= this.threshold) {
				this.openUntil = Date.now() + this.cooldownMs;
			}
			throw error;
		}
	}
}

// Limitation: rejects the caller after `ms` but cannot cancel the underlying query — it keeps running.
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`external identity store timed out (${label}, ${ms}ms)`)),
			ms,
		);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/**
 * Wrap every async method of an IdentityStore with a per-query timeout and the circuit breaker, so a
 * slow/unreachable external DB fails fast instead of hanging identity reads/writes.
 */
export function withResilience(
	store: IdentityStore,
	breaker: CircuitBreaker,
	timeoutMs: number,
): IdentityStore {
	return new Proxy(store, {
		get(target, prop, receiver) {
			const value = Reflect.get(target, prop, receiver);
			if (typeof value !== 'function') {
				return value;
			}
			return (...args: unknown[]) =>
				breaker.exec(() =>
					withTimeout(
						(value as (...a: unknown[]) => Promise<unknown>).apply(target, args),
						timeoutMs,
						String(prop),
					),
				);
		},
	}) as IdentityStore;
}
