import { positiveIntOrDefault } from '@api/common/config/positive-int.util';

/**
 * Edge-case coverage for the shared `positiveIntOrDefault` helper (Prompt 38 §6.1). It captures the
 * `Number.parseInt(String(raw), 10)` + `> 0` shape that was hand-copied across the session-TTL services,
 * the brute-force rate limiters, the SAML clock-skew reader and the audit-retention config. The matrix
 * pins exactly the behaviour those call sites relied on (so adoption stays behaviour-preserving).
 */
describe('positiveIntOrDefault (§6.1)', () => {
	it('CFG-PINT-01: an in-range positive integer string is used', () => {
		expect(positiveIntOrDefault('3600', 120)).toBe(3600);
		expect(positiveIntOrDefault('1', 120)).toBe(1);
		expect(positiveIntOrDefault(900000, 5)).toBe(900000); // numeric input
	});

	it('CFG-PINT-02: unset / blank / nullish → fallback', () => {
		expect(positiveIntOrDefault(undefined, 90)).toBe(90);
		expect(positiveIntOrDefault(null, 90)).toBe(90);
		expect(positiveIntOrDefault('', 90)).toBe(90);
		expect(positiveIntOrDefault('   ', 90)).toBe(90);
	});

	it('CFG-PINT-03: zero and negatives → fallback (strictly positive)', () => {
		expect(positiveIntOrDefault('0', 5)).toBe(5);
		expect(positiveIntOrDefault(0, 5)).toBe(5);
		expect(positiveIntOrDefault('-30', 5)).toBe(5);
		expect(positiveIntOrDefault(-1, 5)).toBe(5);
	});

	it('CFG-PINT-04: non-numeric → fallback', () => {
		expect(positiveIntOrDefault('abc', 7)).toBe(7);
		expect(positiveIntOrDefault('NaN', 7)).toBe(7);
		expect(positiveIntOrDefault('Infinity', 7)).toBe(7); // parseInt('Infinity') === NaN
	});

	it('CFG-PINT-05: parseInt leniency is preserved — a trailing unit suffix keeps the leading integer', () => {
		// This is the behaviour the inline copies had (parseInt, not Number); kept for parity.
		expect(positiveIntOrDefault('3600s', 120)).toBe(3600);
		expect(positiveIntOrDefault('90 days', 1)).toBe(90);
		expect(positiveIntOrDefault('12.9', 1)).toBe(12); // truncates at the dot
	});

	it('CFG-PINT-06: a leading-space numeric string still parses (parseInt skips leading whitespace)', () => {
		expect(positiveIntOrDefault('  42', 1)).toBe(42);
	});

	it('CFG-PINT-07: a value that is not a leading integer → fallback', () => {
		expect(positiveIntOrDefault('s3600', 120)).toBe(120);
		expect(positiveIntOrDefault('+', 120)).toBe(120);
	});
});
