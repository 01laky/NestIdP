/**
 * Concurrency-race test harness (Prompt 38 §12).
 *
 * `runConcurrently` kicks off N invocations of `fn` in the same tick (every `fn(i)` is called before any
 * promise is awaited), so they genuinely overlap against a shared resource (e.g. one libSQL row). Use it
 * to prove a race fix: assert the invariant holds under overlap, and that the test *fails* on the pre-fix
 * code (verify once by reverting).
 *
 * `runConcurrentlySettled` is the same but never rejects — each result is a `PromiseSettledResult`, so a
 * test can assert "exactly one fulfilled, N-1 rejected" (the canonical shape for an atomic claim).
 */
export function runConcurrently<T>(n: number, fn: (index: number) => Promise<T>): Promise<T[]> {
	const tasks: Array<Promise<T>> = [];
	for (let i = 0; i < n; i += 1) {
		tasks.push(fn(i));
	}
	return Promise.all(tasks);
}

export function runConcurrentlySettled<T>(
	n: number,
	fn: (index: number) => Promise<T>,
): Promise<Array<PromiseSettledResult<T>>> {
	const tasks: Array<Promise<T>> = [];
	for (let i = 0; i < n; i += 1) {
		tasks.push(fn(i));
	}
	return Promise.allSettled(tasks);
}

/** Count fulfilled results in a settled array (e.g. how many concurrent claimers won). */
export function countFulfilled(results: Array<PromiseSettledResult<unknown>>): number {
	return results.filter((r) => r.status === 'fulfilled').length;
}
