import {
	assertProductionBootstrapPassword,
	DEFAULT_ADMIN_PASSWORD,
	isWeakBootstrapPassword,
	normalizeBootstrapCredential,
} from './bootstrap-security';

describe('bootstrap-security', () => {
	it('detects default changeme password as weak', () => {
		expect(isWeakBootstrapPassword(DEFAULT_ADMIN_PASSWORD)).toBe(true);
	});

	it('detects short passwords as weak', () => {
		expect(isWeakBootstrapPassword('short')).toBe(true);
	});

	it('accepts strong password', () => {
		expect(isWeakBootstrapPassword('strong-password-123')).toBe(false);
	});

	it('API-BST-13: production + weak password + zero admins throws', () => {
		expect(() => assertProductionBootstrapPassword('production', 'changeme', 0)).toThrow(
			/weak ADMIN_PASSWORD/,
		);
	});

	it('API-BST-14: production + strong password + zero admins passes', () => {
		expect(() =>
			assertProductionBootstrapPassword('production', 'strong-password-123', 0),
		).not.toThrow();
	});

	it('API-BST-15: production + missing password + zero admins throws', () => {
		expect(() => assertProductionBootstrapPassword('production', undefined, 0)).toThrow(
			/without ADMIN_PASSWORD/,
		);
	});

	it('API-BST-11: whitespace-only credential normalizes to undefined', () => {
		expect(normalizeBootstrapCredential('   ')).toBeUndefined();
	});

	it('API-BST-SEC-01: undefined password is weak', () => {
		expect(isWeakBootstrapPassword(undefined)).toBe(true);
	});

	it('API-BST-SEC-02: exactly 12 char non-default password is not weak', () => {
		expect(isWeakBootstrapPassword('abcdefgh1234')).toBe(false);
	});

	it('API-BST-SEC-03: production guard skipped when admins already exist', () => {
		expect(() => assertProductionBootstrapPassword('production', 'changeme', 2)).not.toThrow();
	});
});
