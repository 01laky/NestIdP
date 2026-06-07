import {
	CircuitBreaker,
	withResilience,
	withTimeout,
} from '@api/identity/store/external/resilience';
import type { IdentityStore } from '@api/identity/store/identity-store';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('CircuitBreaker (RES-CB)', () => {
	it('RES-CB-01: stays closed and resets the failure count on success', async () => {
		const cb = new CircuitBreaker(3, 1000);
		await expect(cb.exec(async () => 'ok')).resolves.toBe('ok');
		expect(cb.state).toBe('closed');
	});

	it('RES-CB-02: opens after the threshold of consecutive failures and fails fast', async () => {
		const cb = new CircuitBreaker(3, 10_000);
		for (let i = 0; i < 3; i += 1) {
			await expect(cb.exec(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
		}
		expect(cb.state).toBe('open');
		// while open, the inner fn is not even called
		const inner = jest.fn();
		await expect(cb.exec(inner)).rejects.toThrow(/circuit_open/);
		expect(inner).not.toHaveBeenCalled();
	});

	it('RES-CB-03: half-opens after cooldown, then closes on the next success', async () => {
		const cb = new CircuitBreaker(1, 5);
		await expect(cb.exec(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
		expect(cb.state).toBe('open');
		await new Promise((r) => setTimeout(r, 12));
		expect(cb.state).toBe('half-open');
		await expect(cb.exec(async () => 'recovered')).resolves.toBe('recovered');
		expect(cb.state).toBe('closed');
	});

	it('RES-CB-04: a single failure (below threshold) reports half-open, not open', async () => {
		const cb = new CircuitBreaker(3, 1000);
		await expect(cb.exec(async () => Promise.reject(new Error('one')))).rejects.toThrow('one');
		expect(cb.state).toBe('half-open');
	});
});

describe('withTimeout (RES-TO)', () => {
	it('RES-TO-01: resolves a fast promise', async () => {
		await expect(withTimeout(Promise.resolve(42), 1000, 'fast')).resolves.toBe(42);
	});

	it('RES-TO-02: rejects after the timeout for a slow promise', async () => {
		const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 1000));
		await expect(withTimeout(slow, 10, 'slow')).rejects.toThrow(/timed out \(slow, 10ms\)/);
	});

	it('RES-TO-03: propagates the underlying rejection', async () => {
		await expect(withTimeout(Promise.reject(new Error('inner')), 1000, 'err')).rejects.toThrow(
			'inner',
		);
	});
});

describe('withResilience (RES-WRAP)', () => {
	function fakeStore(impl: Partial<Record<keyof IdentityStore, unknown>>): IdentityStore {
		return impl as unknown as IdentityStore;
	}

	it('RES-WRAP-01: wraps async methods with breaker + timeout and returns results', async () => {
		const store = fakeStore({ countUsers: jest.fn().mockResolvedValue(7) });
		const cb = new CircuitBreaker();
		const wrapped = withResilience(store, cb, 1000);
		await expect(wrapped.countUsers()).resolves.toBe(7);
	});

	it('RES-WRAP-02: a hung method is aborted by the per-query timeout', async () => {
		const store = fakeStore({
			countUsers: jest.fn(() => new Promise(() => undefined)), // never resolves
		});
		const wrapped = withResilience(store, new CircuitBreaker(), 10);
		await expect(wrapped.countUsers()).rejects.toThrow(/timed out/);
	});

	it('RES-WRAP-03: repeated failures open the breaker so calls fail fast', async () => {
		const inner = jest.fn(() => Promise.reject(new Error('db down')));
		const store = fakeStore({ countUsers: inner });
		const cb = new CircuitBreaker(2, 10_000);
		const wrapped = withResilience(store, cb, 1000);
		await expect(wrapped.countUsers()).rejects.toThrow('db down');
		await expect(wrapped.countUsers()).rejects.toThrow('db down');
		await tick();
		const callsBefore = inner.mock.calls.length;
		await expect(wrapped.countUsers()).rejects.toThrow(/circuit_open/);
		expect(inner.mock.calls.length).toBe(callsBefore); // not called while open
	});

	it('RES-WRAP-04: passes non-function properties through untouched', () => {
		const store = fakeStore({ countUsers: jest.fn() });
		(store as unknown as { marker: string }).marker = 'plain';
		const wrapped = withResilience(store, new CircuitBreaker(), 1000) as unknown as {
			marker: string;
		};
		expect(wrapped.marker).toBe('plain');
	});
});
