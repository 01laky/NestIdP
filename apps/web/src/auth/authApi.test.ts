import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_API_PATH, SAML_SESSION_QUERY_PARAM } from '@nestidp/shared';
import {
	AuthApiError,
	completeSsoLogin,
	getEndUserMe,
	getEndUserSession,
	loginEndUser,
	logoutEndUser,
} from './authApi';

describe('authApi', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('WEB-AUTH-API-01: loginEndUser uses credentials include and throws AuthApiError on 401', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 401,
			statusText: 'Unauthorized',
			json: async () => ({ statusCode: 401, message: 'Invalid username or password' }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(loginEndUser({ username: 'alice', password: 'wrong' })).rejects.toBeInstanceOf(
			AuthApiError,
		);

		expect(fetchMock).toHaveBeenCalledWith(
			`${AUTH_API_PATH}/login`,
			expect.objectContaining({
				method: 'POST',
				credentials: 'include',
			}),
		);
	});

	it('WEB-AUTH-API-02: getEndUserMe calls /api/auth/me', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ user: { id: '1', username: 'alice' } }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(getEndUserMe()).resolves.toEqual({
			user: { id: '1', username: 'alice' },
		});
		expect(fetchMock).toHaveBeenCalledWith(
			`${AUTH_API_PATH}/me`,
			expect.objectContaining({ credentials: 'include' }),
		);
	});

	it('WEB-AUTH-API-04: completeSsoLogin returns HTML on 200', async () => {
		const sessionId = 'clxxxxxxxxxxxxxxxxxxxxxxxxx';
		const html = '<html><form><input name="SAMLResponse" value="abc"/></form></html>';
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => html,
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(completeSsoLogin(sessionId)).resolves.toBe(html);
	});

	it('WEB-AUTH-API-07: completeSsoLogin throws AuthApiError on 401', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 401,
			statusText: 'Unauthorized',
			json: async () => ({ statusCode: 401, message: 'Unauthorized' }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(completeSsoLogin('clxxxxxxxxxxxxxxxxxxxxxxxxx')).rejects.toBeInstanceOf(
			AuthApiError,
		);
	});

	it('WEB-AUTH-API-05: loginEndUser surfaces 429 rate limit message', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 429,
			statusText: 'Too Many Requests',
			json: async () => ({ statusCode: 429, message: 'Too many login attempts' }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(loginEndUser({ username: 'alice', password: 'x' })).rejects.toMatchObject({
			statusCode: 429,
			message: 'Too many login attempts',
		});
	});

	it('WEB-AUTH-API-06: logoutEndUser POSTs /api/auth/logout', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ok: true }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(logoutEndUser()).resolves.toEqual({ ok: true });
		expect(fetchMock).toHaveBeenCalledWith(
			`${AUTH_API_PATH}/logout`,
			expect.objectContaining({ method: 'POST', credentials: 'include' }),
		);
	});

	it('WEB-AUTH-API-03: getEndUserSession appends samlSessionId query param', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ authenticated: false, user: null, samlSession: null }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await getEndUserSession('clxxxxxxxxxxxxxxxxxxxxxxxxx');
		expect(fetchMock).toHaveBeenCalledWith(
			`${AUTH_API_PATH}/session?${SAML_SESSION_QUERY_PARAM}=clxxxxxxxxxxxxxxxxxxxxxxxxx`,
			expect.any(Object),
		);
	});
});
