import { isUniqueConstraintError } from '@api/common/utils/prisma-error.util';

/**
 * Edge-case coverage for the shared `isUniqueConstraintError` (Prompt 38 §A4/§6). It is deliberately
 * structural (checks `code === 'P2002'` without importing Prisma), so the matrix below pins exactly which
 * shapes count as a unique-constraint violation and which must NOT — the SAML SSO / logout race handlers
 * branch on this and a false positive would swallow an unrelated error.
 */
describe('isUniqueConstraintError (§A4)', () => {
	it('API-P2002-01: an object with code P2002 is a unique-constraint violation', () => {
		expect(isUniqueConstraintError({ code: 'P2002' })).toBe(true);
	});

	it('API-P2002-02: a real-looking Prisma error object matches', () => {
		expect(
			isUniqueConstraintError({
				code: 'P2002',
				clientVersion: '5.0.0',
				meta: { target: ['username'] },
				message: 'Unique constraint failed',
			}),
		).toBe(true);
	});

	it('API-P2002-03: an Error instance carrying code P2002 matches (code lives on the object)', () => {
		const err = Object.assign(new Error('dup'), { code: 'P2002' });
		expect(isUniqueConstraintError(err)).toBe(true);
	});

	it('API-P2002-04: other Prisma codes do NOT match', () => {
		expect(isUniqueConstraintError({ code: 'P2003' })).toBe(false); // FK violation
		expect(isUniqueConstraintError({ code: 'P2025' })).toBe(false); // not found
		expect(isUniqueConstraintError({ code: 'p2002' })).toBe(false); // case-sensitive
		expect(isUniqueConstraintError({ code: 'P2002 ' })).toBe(false); // trailing space
		expect(isUniqueConstraintError({ code: '' })).toBe(false);
	});

	it('API-P2002-05: a numeric code 2002 does NOT match (strict string equality)', () => {
		expect(isUniqueConstraintError({ code: 2002 })).toBe(false);
	});

	it('API-P2002-06: objects without a code property do not match', () => {
		expect(isUniqueConstraintError({})).toBe(false);
		expect(isUniqueConstraintError({ message: 'P2002' })).toBe(false);
		expect(isUniqueConstraintError(new Error('P2002'))).toBe(false);
	});

	it('API-P2002-07: non-object inputs never match and never throw', () => {
		expect(isUniqueConstraintError(null)).toBe(false);
		expect(isUniqueConstraintError(undefined)).toBe(false);
		expect(isUniqueConstraintError('P2002')).toBe(false);
		expect(isUniqueConstraintError(2002)).toBe(false);
		expect(isUniqueConstraintError(true)).toBe(false);
	});

	it('API-P2002-08: arrays and a null-prototype bag are handled by the structural check', () => {
		expect(isUniqueConstraintError(['P2002'])).toBe(false);
		const bag = Object.assign(Object.create(null), { code: 'P2002' }) as object;
		expect(isUniqueConstraintError(bag)).toBe(true);
	});

	it('API-P2002-09: a code getter that returns P2002 matches (property access, not own-enumerable)', () => {
		const withGetter = {
			get code() {
				return 'P2002';
			},
		};
		expect(isUniqueConstraintError(withGetter)).toBe(true);
	});
});
