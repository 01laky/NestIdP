/** Run `worker` over items with at most `concurrency` in flight. */
export async function runPool<T>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let index = 0;
	const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (index < items.length) {
			const current = items[index];
			index += 1;
			await worker(current);
		}
	});
	await Promise.all(runners);
}
