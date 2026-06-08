import { nextCronRun } from '@nestidp/shared';

/**
 * Compute the next run instant for a cron schedule, with optional jitter.
 *
 * The base instant is the first true cron occurrence strictly after `after`. Jitter adds a random
 * offset in `[0, jitterMaxSeconds]` so connections sharing a cron (e.g. all "daily 02:00") do not hit
 * the external API at the exact same instant. The offset is always non-negative, so a jittered run is
 * never moved *before* the true cron time. With `jitterMaxSeconds = 0` the result is exact.
 *
 * `random` must return a value in `[0, 1)` (defaults to `Math.random`); it is injectable for tests.
 */
export function computeNextRunAt(
	cron: string,
	timezone: string,
	after: Date,
	jitterMaxSeconds: number,
	random: () => number = Math.random,
): Date {
	const base = nextCronRun(cron, timezone, after);
	if (jitterMaxSeconds <= 0) {
		return base;
	}
	const offsetMs = Math.floor(random() * jitterMaxSeconds * 1000);
	return new Date(base.getTime() + offsetMs);
}

/** Whole minutes by which `nextRunAt` is overdue relative to `now` (0 when not overdue). */
export function overdueMinutes(nextRunAt: Date, now: Date): number {
	const diffMs = now.getTime() - nextRunAt.getTime();
	if (diffMs <= 0) {
		return 0;
	}
	return diffMs / 60_000;
}
