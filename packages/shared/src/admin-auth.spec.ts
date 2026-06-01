import { describe, expect, it } from 'vitest';
import { ADMIN_SESSION_COOKIE_NAME } from './admin-auth.js';
import { BCRYPT_COST_FACTOR } from './password-hash-algorithms.js';

describe('admin-auth shared types', () => {
	it('SH-ADM-01: ADMIN_SESSION_COOKIE_NAME is nestidp_admin_session', () => {
		expect(ADMIN_SESSION_COOKIE_NAME).toBe('nestidp_admin_session');
	});

	it('SH-ADM-02: BCRYPT_COST_FACTOR is 12', () => {
		expect(BCRYPT_COST_FACTOR).toBe(12);
	});
});
