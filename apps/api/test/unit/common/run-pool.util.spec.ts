import { runPool } from '@api/common/utils/run-pool.util';

describe('runPool (§5.C)', () => {
	it('RUNPOOL-01: processes every item exactly once and respects the concurrency bound', async () => {
		const items = Array.from({ length: 20 }, (_, i) => i);
		const seen: number[] = [];
		let inFlight = 0;
		let maxInFlight = 0;

		await runPool(items, 3, async (item) => {
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			// Yield so other runners can overlap.
			await new Promise((resolve) => setTimeout(resolve, 1));
			seen.push(item);
			inFlight -= 1;
		});

		expect(seen).toHaveLength(20);
		expect(new Set(seen).size).toBe(20);
		expect(maxInFlight).toBeGreaterThan(1);
		expect(maxInFlight).toBeLessThanOrEqual(3);
	});

	it('RUNPOOL-02: completion is order-independent — slow items do not block other runners', async () => {
		const completed: number[] = [];
		await runPool([0, 1, 2], 2, async (item) => {
			// Item 0 is slow; items 1 and 2 finish first on the other runner.
			await new Promise((resolve) => setTimeout(resolve, item === 0 ? 20 : 1));
			completed.push(item);
		});
		expect(completed).toHaveLength(3);
		expect(completed[completed.length - 1]).toBe(0);
	});

	it('RUNPOOL-03: a worker throw rejects the pool (callers isolate per-item when needed)', async () => {
		const seen: number[] = [];
		await expect(
			runPool([1, 2, 3], 1, async (item) => {
				if (item === 2) {
					throw new Error('boom');
				}
				seen.push(item);
			}),
		).rejects.toThrow('boom');
		expect(seen).toEqual([1]);
	});

	it('RUNPOOL-04: empty input resolves without invoking the worker', async () => {
		const worker = jest.fn();
		await runPool([], 5, worker);
		expect(worker).not.toHaveBeenCalled();
	});
});
