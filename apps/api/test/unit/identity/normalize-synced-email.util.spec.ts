import { normalizeSyncedEmail } from '@api/identity/utils/normalize-synced-email.util';

describe('normalizeSyncedEmail', () => {
	it('returns null for null, undefined, blank, or whitespace-only input', () => {
		expect(normalizeSyncedEmail(null)).toBeNull();
		expect(normalizeSyncedEmail(undefined)).toBeNull();
		expect(normalizeSyncedEmail('')).toBeNull();
		expect(normalizeSyncedEmail('   ')).toBeNull();
	});

	it('lowercases and trims valid email', () => {
		expect(normalizeSyncedEmail('  Alice@Example.COM  ')).toBe('alice@example.com');
	});

	it('throws when email lacks @', () => {
		expect(() => normalizeSyncedEmail('not-an-email')).toThrow('Invalid email');
	});

	it('throws when email exceeds 256 characters', () => {
		const longLocal = 'a'.repeat(250);
		expect(() => normalizeSyncedEmail(`${longLocal}@example.com`)).toThrow('Invalid email');
	});
});
