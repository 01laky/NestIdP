import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_CSRF_HEADER_NAME, API_CONNECTIONS_API_PATH } from '@nestidp/shared';
import {
	AdminApiError,
	adminFetch,
	createApiConnection,
	deleteApiConnection,
	getApiConnection,
	getCsrfToken,
	listApiConnections,
	loginAdmin,
	logoutAdmin,
	setCsrfToken,
	testApiConnection,
	updateApiConnection,
	getAdminMe,
} from './adminApi';

describe('adminApi', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		setCsrfToken(null);
	});

	it('WEB-ADM-08: loginAdmin uses credentials include and throws AdminApiError on 401', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 401,
			statusText: 'Unauthorized',
			json: async () => ({ statusCode: 401, message: 'Invalid credentials' }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(loginAdmin({ username: 'admin', password: 'wrong' })).rejects.toBeInstanceOf(
			AdminApiError,
		);

		expect(fetchMock).toHaveBeenCalledWith(
			'/api/admin/auth/login',
			expect.objectContaining({
				method: 'POST',
				credentials: 'include',
			}),
		);
	});

	it('adminFetch returns parsed JSON on success', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({ ok: true }),
			}),
		);

		await expect(adminFetch('/api/admin/auth/logout', { method: 'POST' })).resolves.toEqual({
			ok: true,
		});
	});

	it('WEB-ADM-13: adminFetch sends CSRF header on POST after login', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({
					ok: true,
					admin: { id: '1', username: 'admin' },
					csrfToken: 'stored-csrf-token',
				}),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({ ok: true }),
			});
		vi.stubGlobal('fetch', fetchMock);

		await loginAdmin({ username: 'admin', password: 'secret' });
		await logoutAdmin();

		expect(fetchMock).toHaveBeenLastCalledWith(
			'/api/admin/auth/logout',
			expect.objectContaining({
				credentials: 'include',
				method: 'POST',
				headers: expect.objectContaining({
					[ADMIN_CSRF_HEADER_NAME]: 'stored-csrf-token',
				}),
			}),
		);
	});

	it('WEB-ADM-14: CSRF token cleared on logout', async () => {
		setCsrfToken('before-logout');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ok: true }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await logoutAdmin();
		expect(getCsrfToken()).toBeNull();
	});

	it('WEB-ADM-16: AdminApiError exposes statusCode', async () => {
		const error = new AdminApiError(429, 'Too many login attempts');
		expect(error.statusCode).toBe(429);
		expect(error.message).toBe('Too many login attempts');
	});

	it('WEB-API-01: createApiConnection POSTs to API_CONNECTIONS_API_PATH with CSRF header', async () => {
		setCsrfToken('csrf-for-create');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 201,
			json: async () => ({ connection: { id: '1', name: 'Corp' } }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await createApiConnection({
			name: 'Corp',
			baseUrl: 'https://identity.example.com',
			bearerToken: 'secret',
		});

		expect(fetchMock).toHaveBeenCalledWith(
			API_CONNECTIONS_API_PATH,
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					[ADMIN_CSRF_HEADER_NAME]: 'csrf-for-create',
				}),
			}),
		);
	});

	it('WEB-API-02: listApiConnections GET without CSRF', async () => {
		setCsrfToken('should-not-send-on-get');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ connections: [] }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await listApiConnections();

		const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
		expect(headers[ADMIN_CSRF_HEADER_NAME]).toBeUndefined();
	});

	it('WEB-API-03: testApiConnection POSTs to .../:id/test with CSRF header', async () => {
		setCsrfToken('csrf-for-test');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ok: true, reachable: true, message: 'ok' }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await testApiConnection('conn-1');

		expect(fetchMock).toHaveBeenCalledWith(
			`${API_CONNECTIONS_API_PATH}/conn-1/test`,
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					[ADMIN_CSRF_HEADER_NAME]: 'csrf-for-test',
				}),
			}),
		);
	});

	it('WEB-API-04: updateApiConnection PATCH with CSRF header', async () => {
		setCsrfToken('csrf-patch');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ connection: { id: '1' } }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await updateApiConnection('conn-1', { name: 'Renamed' });

		expect(fetchMock).toHaveBeenCalledWith(
			`${API_CONNECTIONS_API_PATH}/conn-1`,
			expect.objectContaining({
				method: 'PATCH',
				headers: expect.objectContaining({ [ADMIN_CSRF_HEADER_NAME]: 'csrf-patch' }),
			}),
		);
	});

	it('WEB-API-05: deleteApiConnection DELETE with CSRF header', async () => {
		setCsrfToken('csrf-delete');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ok: true, id: 'conn-1' }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await deleteApiConnection('conn-1');

		expect(fetchMock).toHaveBeenCalledWith(
			`${API_CONNECTIONS_API_PATH}/conn-1`,
			expect.objectContaining({
				method: 'DELETE',
				headers: expect.objectContaining({ [ADMIN_CSRF_HEADER_NAME]: 'csrf-delete' }),
			}),
		);
	});

	it('WEB-API-06: getApiConnection GET without CSRF header', async () => {
		setCsrfToken('should-not-send');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ connection: { id: '1' } }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await getApiConnection('conn-1');

		const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
		expect(headers[ADMIN_CSRF_HEADER_NAME]).toBeUndefined();
	});

	it('WEB-ADM-17: loginAdmin stores csrfToken from response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					ok: true,
					admin: { id: '1', username: 'admin' },
					csrfToken: 'login-csrf-token',
				}),
			}),
		);

		await loginAdmin({ username: 'admin', password: 'secret' });
		expect(getCsrfToken()).toBe('login-csrf-token');
	});

	it('WEB-ADM-18: getAdminMe stores csrfToken from response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					admin: { id: '1', username: 'admin' },
					csrfToken: 'me-csrf-token',
				}),
			}),
		);

		await getAdminMe();
		expect(getCsrfToken()).toBe('me-csrf-token');
	});

	it('WEB-ADM-19: adminFetch does not attach CSRF on GET when token set', async () => {
		setCsrfToken('stored-token');
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ connections: [] }),
		});
		vi.stubGlobal('fetch', fetchMock);

		await adminFetch('/api/admin/api-connections');

		const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
		expect(headers[ADMIN_CSRF_HEADER_NAME]).toBeUndefined();
	});
});
