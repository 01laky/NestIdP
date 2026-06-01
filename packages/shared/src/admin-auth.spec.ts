import { describe, expect, it } from 'vitest';
import { ADMIN_CSRF_HEADER_NAME, ADMIN_SESSION_COOKIE_NAME } from './admin-auth.js';
import { BCRYPT_COST_FACTOR } from './password-hash-algorithms.js';
import type { AdminLoginResponseDto, AdminMeResponseDto } from './admin-auth.js';

describe('admin-auth shared types', () => {
	it('SH-ADM-01: ADMIN_SESSION_COOKIE_NAME is nestidp_admin_session', () => {
		expect(ADMIN_SESSION_COOKIE_NAME).toBe('nestidp_admin_session');
	});

	it('SH-ADM-02: BCRYPT_COST_FACTOR is 12', () => {
		expect(BCRYPT_COST_FACTOR).toBe(12);
	});

	it('SH-CSRF-01: Admin DTOs include csrfToken field', () => {
		const login: AdminLoginResponseDto = {
			ok: true,
			admin: { id: '1', username: 'admin' },
			csrfToken: 'abc',
		};
		const me: AdminMeResponseDto = {
			admin: { id: '1', username: 'admin' },
			csrfToken: 'abc',
		};
		expect(login.csrfToken).toBe('abc');
		expect(me.csrfToken).toBe('abc');
		expect(ADMIN_CSRF_HEADER_NAME).toBe('X-CSRF-Token');
	});
});
