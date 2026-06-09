import { boundedInt } from '@api/common/config/bounded-int.util';
import { parseBoolEnv } from '@api/common/config/parse-bool-env.util';

describe('boundedInt (§6.1)', () => {
	it('CFG-BINT-01: in-range value is used; out-of-range → fallback (matches the inline copies)', () => {
		expect(boundedInt('50', 10, 1, 100)).toBe(50);
		expect(boundedInt('500', 10, 1, 100)).toBe(10); // above max → fallback
		expect(boundedInt('-5', 10, 1, 100)).toBe(10); // below min → fallback
		expect(boundedInt(42, 10, 1, 100)).toBe(42); // numeric input
	});

	it('CFG-BINT-02: empty / whitespace / unset → fallback (NOT 0 — the §A1 fix)', () => {
		expect(boundedInt('', 30_000, 0, 60_000)).toBe(30_000);
		expect(boundedInt('   ', 30_000, 0, 60_000)).toBe(30_000);
		expect(boundedInt(undefined, 30_000, 0, 60_000)).toBe(30_000);
		expect(boundedInt(null, 30_000, 0, 60_000)).toBe(30_000);
	});

	it('CFG-BINT-03: non-numeric → fallback', () => {
		expect(boundedInt('abc', 7, 1, 10)).toBe(7);
	});
});

describe('parseBoolEnv (§6.1)', () => {
	it('CFG-BOOL-01: truthy values', () => {
		for (const v of ['1', 'true', 'TRUE', 'yes', 'On']) {
			expect(parseBoolEnv(v)).toBe(true);
		}
	});

	it('CFG-BOOL-02: everything else → fallback', () => {
		expect(parseBoolEnv('0')).toBe(false);
		expect(parseBoolEnv('false')).toBe(false);
		expect(parseBoolEnv('nope')).toBe(false);
		expect(parseBoolEnv('')).toBe(false);
		expect(parseBoolEnv(undefined)).toBe(false);
		expect(parseBoolEnv(undefined, true)).toBe(true); // explicit fallback
	});
});
