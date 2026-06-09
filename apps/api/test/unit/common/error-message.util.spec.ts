import { errorMessage } from '@api/common/utils/error-message.util';

/**
 * Edge-case coverage for the shared `errorMessage` helper (Prompt 38 §A4/§6) — the single source of truth
 * for the `error instanceof Error ? error.message : String(error)` idiom. The behaviour the de-duplicated
 * call sites relied on must be reproduced exactly for every shape a `catch (e: unknown)` can hand it.
 */
describe('errorMessage (§A4)', () => {
	it('API-ERRMSG-01: Error instance → its .message', () => {
		expect(errorMessage(new Error('boom'))).toBe('boom');
		expect(errorMessage(new TypeError('bad type'))).toBe('bad type');
		expect(errorMessage(new RangeError('out of range'))).toBe('out of range');
	});

	it('API-ERRMSG-02: Error subclass keeps its message', () => {
		class DomainError extends Error {
			constructor() {
				super('domain failed');
				this.name = 'DomainError';
			}
		}
		expect(errorMessage(new DomainError())).toBe('domain failed');
	});

	it('API-ERRMSG-03: Error with empty message → empty string (not the name)', () => {
		expect(errorMessage(new Error(''))).toBe('');
	});

	it('API-ERRMSG-04: primitive strings/numbers/booleans are stringified', () => {
		expect(errorMessage('plain string')).toBe('plain string');
		expect(errorMessage(42)).toBe('42');
		expect(errorMessage(0)).toBe('0');
		expect(errorMessage(true)).toBe('true');
		expect(errorMessage(false)).toBe('false');
		expect(errorMessage(BigInt(7))).toBe('7');
	});

	it('API-ERRMSG-05: null and undefined are stringified, never throw', () => {
		expect(errorMessage(null)).toBe('null');
		expect(errorMessage(undefined)).toBe('undefined');
	});

	it('API-ERRMSG-06: plain object → its String() form (NOT message extraction)', () => {
		// A non-Error object that happens to carry a `message` is NOT special-cased.
		expect(errorMessage({ message: 'ignored' })).toBe('[object Object]');
		expect(errorMessage({})).toBe('[object Object]');
	});

	it('API-ERRMSG-07: object with a custom toString is honoured', () => {
		expect(errorMessage({ toString: () => 'custom repr' })).toBe('custom repr');
	});

	it('API-ERRMSG-08: arrays and symbols are stringified without throwing', () => {
		expect(errorMessage(['a', 'b'])).toBe('a,b');
		expect(errorMessage([])).toBe('');
		expect(errorMessage(Symbol('sym'))).toBe('Symbol(sym)');
	});

	it('API-ERRMSG-09: documented limitation — a null-prototype object has no toString, so String() throws', () => {
		// This is the one shape `errorMessage` cannot coerce: a null-prototype object exposes neither
		// toString nor valueOf, so the ToPrimitive conversion in String() throws. Documented, not "safe".
		const bag = Object.create(null) as object;
		expect(() => errorMessage(bag)).toThrow(TypeError);
	});
});
