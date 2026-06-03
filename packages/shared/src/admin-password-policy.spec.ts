import { describe, expect, it } from 'vitest';
import {
	assertStrongAdminPassword,
	DEFAULT_ADMIN_PASSWORD,
	isWeakAdminPassword,
	MIN_STRONG_ADMIN_PASSWORD_LENGTH,
} from './admin-password-policy.js';

describe('admin-password-policy', () => {
	it('SH-ADM-PWD-01: DEFAULT_ADMIN_PASSWORD is changeme', () => {
		expect(DEFAULT_ADMIN_PASSWORD).toBe('changeme');
	});

	it('SH-ADM-PWD-02: MIN_STRONG_ADMIN_PASSWORD_LENGTH is 12', () => {
		expect(MIN_STRONG_ADMIN_PASSWORD_LENGTH).toBe(12);
	});

	it('SH-ADM-PWD-03: isWeakAdminPassword treats undefined as weak', () => {
		expect(isWeakAdminPassword(undefined)).toBe(true);
	});

	it('SH-ADM-PWD-04: isWeakAdminPassword treats empty and whitespace as weak', () => {
		expect(isWeakAdminPassword('')).toBe(true);
		expect(isWeakAdminPassword('   ')).toBe(true);
	});

	it('SH-ADM-PWD-05: isWeakAdminPassword rejects default bootstrap password', () => {
		expect(isWeakAdminPassword(DEFAULT_ADMIN_PASSWORD)).toBe(true);
	});

	it('SH-ADM-PWD-06: isWeakAdminPassword rejects passwords shorter than 12 chars', () => {
		expect(isWeakAdminPassword('Short1!')).toBe(true);
		expect(isWeakAdminPassword('a'.repeat(11))).toBe(true);
	});

	it('SH-ADM-PWD-07: isWeakAdminPassword accepts 12+ char non-default password', () => {
		expect(isWeakAdminPassword('ValidPassword1')).toBe(false);
	});

	it('SH-ADM-PWD-08: assertStrongAdminPassword no-op outside production', () => {
		expect(() => assertStrongAdminPassword('test', 'weak')).not.toThrow();
		expect(() => assertStrongAdminPassword('development', DEFAULT_ADMIN_PASSWORD)).not.toThrow();
	});

	it('SH-ADM-PWD-09: assertStrongAdminPassword throws in production for weak password', () => {
		expect(() => assertStrongAdminPassword('production', 'short')).toThrow(
			'Password does not meet production strength requirements',
		);
		expect(() => assertStrongAdminPassword('production', DEFAULT_ADMIN_PASSWORD)).toThrow(
			'Password does not meet production strength requirements',
		);
	});

	it('SH-ADM-PWD-10: assertStrongAdminPassword allows strong password in production', () => {
		expect(() => assertStrongAdminPassword('production', 'SecurePass1234')).not.toThrow();
	});
});
