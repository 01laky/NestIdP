import { SlidingWindowRateLimiter } from '@api/common/rate-limit/sliding-window-rate-limiter';

describe('SlidingWindowRateLimiter (Prompt 35)', () => {
	it('RL-CORE-01: under the limit not limited; at the limit limited with positive retryAfterMs', () => {
		const now = 1_000_000;
		const rl = new SlidingWindowRateLimiter(() => now);
		expect(rl.check('k', 3, 10_000).limited).toBe(false);
		rl.record('k', 10_000);
		rl.record('k', 10_000);
		expect(rl.check('k', 3, 10_000).limited).toBe(false); // count 2 < 3
		rl.record('k', 10_000); // count 3
		const res = rl.check('k', 3, 10_000);
		expect(res.limited).toBe(true);
		expect(res.retryAfterMs).toBeGreaterThan(0);
		expect(res.retryAfterMs).toBeLessThanOrEqual(10_000);
	});

	it('RL-CORE-02: the window rolls over and the counter resets', () => {
		let now = 0;
		const rl = new SlidingWindowRateLimiter(() => now);
		for (let i = 0; i < 5; i += 1) {
			rl.record('k', 1000);
		}
		expect(rl.check('k', 5, 1000).limited).toBe(true);
		now += 1001; // window elapsed
		expect(rl.check('k', 5, 1000).limited).toBe(false);
	});

	it('RL-CORE-03: reset clears one key; clear clears all', () => {
		const rl = new SlidingWindowRateLimiter(() => 0);
		rl.record('a', 1000);
		rl.record('a', 1000);
		rl.record('b', 1000);
		rl.reset('a');
		expect(rl.check('a', 1, 1000).limited).toBe(false);
		expect(rl.check('b', 1, 1000).limited).toBe(true);
		rl.clear();
		expect(rl.check('b', 1, 1000).limited).toBe(false);
		expect(rl.size()).toBe(0);
	});

	it('RL-CORE-04: a stream of distinct keys is pruned and does not grow unbounded', () => {
		let now = 0;
		const rl = new SlidingWindowRateLimiter(() => now);
		for (let i = 0; i < 1000; i += 1) {
			rl.record(`key-${i}`, 1000);
		}
		expect(rl.size()).toBe(1000);
		// advance well past the window + the prune interval, then touch one key to trigger the sweep
		now += 120_000;
		rl.record('trigger', 1000);
		expect(rl.size()).toBeLessThanOrEqual(2);
	});

	it('RL-CORE-05: hit increments then reports limited in one call', () => {
		const rl = new SlidingWindowRateLimiter(() => 0);
		expect(rl.hit('k', 2, 1000).limited).toBe(false); // count 1
		expect(rl.hit('k', 2, 1000).limited).toBe(true); // count 2 >= 2
	});
});
