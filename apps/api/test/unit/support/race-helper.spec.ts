import {
	countFulfilled,
	runConcurrently,
	runConcurrentlySettled,
} from '@test/support/concurrency/race.helper';

/**
 * §12 self-test: prove the harness actually overlaps its invocations — a race test built on a
 * helper that secretly serialises would prove nothing.
 */
describe('race.helper (RACE-SELF, §12)', () => {
	it('RACE-SELF-01: all N invocations start before any completes (true overlap)', async () => {
		const N = 8;
		let active = 0;
		let maxActive = 0;
		let release: () => void = () => undefined;
		const gate = new Promise<void>((r) => {
			release = r;
		});

		const all = runConcurrently(N, async () => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			if (active === N) {
				release(); // only opens once every invocation is in flight simultaneously
			}
			await gate;
			active -= 1;
		});

		await all;
		expect(maxActive).toBe(N);
	});

	it('RACE-SELF-02: every fn(i) is called synchronously in the same tick, in order', async () => {
		const started: number[] = [];
		const p = runConcurrently(4, async (i) => {
			started.push(i);
		});
		// All four pushed before the first await of the returned promise resolves the microtask queue.
		expect(started).toEqual([0, 1, 2, 3]);
		await p;
	});

	it('RACE-SELF-03: runConcurrentlySettled never rejects and countFulfilled counts winners', async () => {
		const results = await runConcurrentlySettled(5, async (i) => {
			if (i !== 2) {
				throw new Error(`loser ${i}`);
			}
			return 'winner';
		});
		expect(results).toHaveLength(5);
		expect(countFulfilled(results)).toBe(1);
		const rejected = results.filter((r) => r.status === 'rejected');
		expect(rejected).toHaveLength(4);
	});

	it('RACE-SELF-04: runConcurrently propagates the first rejection (Promise.all semantics)', async () => {
		await expect(
			runConcurrently(3, async (i) => {
				if (i === 1) {
					throw new Error('boom');
				}
				return i;
			}),
		).rejects.toThrow('boom');
	});
});
