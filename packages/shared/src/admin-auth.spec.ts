import { describe, expect, it } from 'vitest';
import {
	ADMIN_CSRF_HEADER_NAME,
	ADMIN_REMEMBER_USERNAME_STORAGE_KEY,
	ADMIN_SESSION_COOKIE_NAME,
	DEFAULT_ADMIN_SESSION_REMEMBER_TTL_SECONDS,
	DEFAULT_ADMIN_SESSION_TTL_SECONDS,
	MAX_ADMIN_SESSION_REMEMBER_TTL_SECONDS,
} from './admin-auth.js';
import { BCRYPT_COST_FACTOR } from './password-hash-algorithms.js';
import type {
	AdminLoginRequestDto,
	AdminLoginResponseDto,
	AdminMeResponseDto,
} from './admin-auth.js';

describe('admin-auth shared types', () => {
	it('SH-ADM-01: ADMIN_SESSION_COOKIE_NAME is nestidp_admin_session', () => {
		expect(ADMIN_SESSION_COOKIE_NAME).toBe('nestidp_admin_session');
	});

	it('SH-ADM-02: BCRYPT_COST_FACTOR is 12', () => {
		expect(BCRYPT_COST_FACTOR).toBe(12);
	});

	it('SH-ADM-04: ADMIN_REMEMBER_USERNAME_STORAGE_KEY is stable', () => {
		expect(ADMIN_REMEMBER_USERNAME_STORAGE_KEY).toBe('nestidp_admin_remember_username');
	});

	it('SH-ADM-05: default admin session TTL constants', () => {
		expect(DEFAULT_ADMIN_SESSION_TTL_SECONDS).toBe(28_800);
		expect(DEFAULT_ADMIN_SESSION_REMEMBER_TTL_SECONDS).toBe(2_592_000);
	});

	it('SH-ADM-06: MAX_ADMIN_SESSION_REMEMBER_TTL_SECONDS is 90 days', () => {
		expect(MAX_ADMIN_SESSION_REMEMBER_TTL_SECONDS).toBe(7_776_000);
	});

	it('SH-ADM-07: AdminLoginRequestDto allows optional rememberMe', () => {
		const withRemember: AdminLoginRequestDto = {
			username: 'admin',
			password: 'secret',
			rememberMe: true,
		};
		const withoutRemember: AdminLoginRequestDto = {
			username: 'admin',
			password: 'secret',
		};
		expect(withRemember.rememberMe).toBe(true);
		expect(withoutRemember.rememberMe).toBeUndefined();
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
