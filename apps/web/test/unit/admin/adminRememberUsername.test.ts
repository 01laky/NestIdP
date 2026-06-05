import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_REMEMBER_USERNAME_STORAGE_KEY } from '@nestidp/shared';
import {
	clearRememberedAdminUsername,
	readRememberedAdminUsername,
	writeRememberedAdminUsername,
} from '@/admin/adminRememberUsername';

describe('adminRememberUsername (WEB-ADM-RM)', () => {
	afterEach(() => {
		localStorage.clear();
	});

	it('WEB-ADM-RM-01: write + read round-trip', () => {
		writeRememberedAdminUsername('operator');
		expect(readRememberedAdminUsername()).toBe('operator');
		expect(localStorage.getItem(ADMIN_REMEMBER_USERNAME_STORAGE_KEY)).toBe('operator');
	});

	it('WEB-ADM-RM-02: clear removes key', () => {
		writeRememberedAdminUsername('operator');
		clearRememberedAdminUsername();
		expect(readRememberedAdminUsername()).toBeNull();
	});

	it('WEB-ADM-RM-03: trim whitespace on write', () => {
		writeRememberedAdminUsername('  operator  ');
		expect(readRememberedAdminUsername()).toBe('operator');
	});

	it('WEB-ADM-RM-04: empty after trim does not write', () => {
		writeRememberedAdminUsername('   ');
		expect(readRememberedAdminUsername()).toBeNull();
	});

	it('WEB-ADM-RM-05: username longer than 255 chars not stored', () => {
		writeRememberedAdminUsername(`u${'x'.repeat(300)}`);
		expect(readRememberedAdminUsername()).toBeNull();
	});

	it('WEB-ADM-RM-17: read trims whitespace from stored value', () => {
		localStorage.setItem(ADMIN_REMEMBER_USERNAME_STORAGE_KEY, '  stored-op  ');
		expect(readRememberedAdminUsername()).toBe('stored-op');
	});

	it('WEB-ADM-RM-18: read returns null for whitespace-only stored value', () => {
		localStorage.setItem(ADMIN_REMEMBER_USERNAME_STORAGE_KEY, '   ');
		expect(readRememberedAdminUsername()).toBeNull();
	});

	it('WEB-ADM-RM-19: read returns null when key is missing', () => {
		expect(readRememberedAdminUsername()).toBeNull();
	});

	it('WEB-ADM-RM-20: write accepts username at exactly 255 chars', () => {
		const max = `u${'a'.repeat(254)}`;
		writeRememberedAdminUsername(max);
		expect(readRememberedAdminUsername()).toBe(max);
	});

	it('WEB-ADM-RM-21: localStorage errors are swallowed on read/write/clear', () => {
		const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('SecurityError');
		});
		const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('QuotaExceededError');
		});
		const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
			throw new Error('SecurityError');
		});

		expect(readRememberedAdminUsername()).toBeNull();
		expect(() => writeRememberedAdminUsername('operator')).not.toThrow();
		expect(() => clearRememberedAdminUsername()).not.toThrow();

		getItem.mockRestore();
		setItem.mockRestore();
		removeItem.mockRestore();
	});

	it('WEB-ADM-RM-22: clear is safe when key is already absent', () => {
		clearRememberedAdminUsername();
		expect(readRememberedAdminUsername()).toBeNull();
	});
});
