import { computeNextRunAt, overdueMinutes } from '@api/sync/scheduler-time.util';

describe('scheduler-time.util', () => {
	const after = new Date('2026-06-08T10:07:00.000Z');

	it('computeNextRunAt: jitter 0 returns the exact cron instant', () => {
		const next = computeNextRunAt('*/15 * * * *', 'UTC', after, 0);
		expect(next.toISOString()).toBe('2026-06-08T10:15:00.000Z');
	});

	it('HARD-JITTER-01: jitter offsets within [0, max] and never before the true cron time', () => {
		const base = new Date('2026-06-08T10:15:00.000Z').getTime();
		// random near 1 → near-max positive offset; never negative.
		const high = computeNextRunAt('*/15 * * * *', 'UTC', after, 30, () => 0.999);
		expect(high.getTime()).toBeGreaterThanOrEqual(base);
		expect(high.getTime()).toBeLessThanOrEqual(base + 30_000);
		// random 0 → exactly the true cron time (lower bound is inclusive).
		const low = computeNextRunAt('*/15 * * * *', 'UTC', after, 30, () => 0);
		expect(low.getTime()).toBe(base);
	});

	it('HARD-JITTER-01: two connections sharing a cron get offsets within the same slot', () => {
		const base = new Date('2026-06-08T10:15:00.000Z').getTime();
		const a = computeNextRunAt('*/15 * * * *', 'UTC', after, 30, () => 0.2);
		const b = computeNextRunAt('*/15 * * * *', 'UTC', after, 30, () => 0.8);
		for (const d of [a, b]) {
			expect(d.getTime()).toBeGreaterThanOrEqual(base);
			expect(d.getTime()).toBeLessThanOrEqual(base + 30_000);
		}
		expect(Math.abs(a.getTime() - b.getTime())).toBeLessThanOrEqual(30_000);
	});

	it('overdueMinutes: 0 when in the future, positive when in the past', () => {
		const now = new Date('2026-06-08T10:00:00.000Z');
		expect(overdueMinutes(new Date('2026-06-08T10:05:00.000Z'), now)).toBe(0);
		expect(overdueMinutes(new Date('2026-06-08T09:30:00.000Z'), now)).toBe(30);
	});

	it('overdueMinutes: exactly now is 0 (not overdue)', () => {
		const now = new Date('2026-06-08T10:00:00.000Z');
		expect(overdueMinutes(new Date('2026-06-08T10:00:00.000Z'), now)).toBe(0);
	});

	it('computeNextRunAt: jitter clamps to < jitterMaxSeconds even when random returns ~1', () => {
		const base = new Date('2026-06-08T10:15:00.000Z').getTime();
		// Math.floor(0.9999 * 30 * 1000) = 29997ms < 30000ms — never reaches a full extra second past max.
		const d = computeNextRunAt('*/15 * * * *', 'UTC', after, 30, () => 0.9999);
		expect(d.getTime()).toBeGreaterThanOrEqual(base);
		expect(d.getTime()).toBeLessThan(base + 30_000);
	});

	it('computeNextRunAt: negative jitterMaxSeconds is treated as no jitter (exact)', () => {
		const d = computeNextRunAt('*/15 * * * *', 'UTC', after, -5, () => 0.5);
		expect(d.toISOString()).toBe('2026-06-08T10:15:00.000Z');
	});

	it('computeNextRunAt: jitter is applied to the true cron instant for an hourly schedule', () => {
		const base = new Date('2026-06-08T11:00:00.000Z').getTime();
		const d = computeNextRunAt('0 * * * *', 'UTC', new Date('2026-06-08T10:07:00Z'), 60, () => 0.5);
		expect(d.getTime()).toBe(base + 30_000); // 0.5 * 60s = 30s offset
	});
});
