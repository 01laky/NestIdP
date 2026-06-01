import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminApiError, adminFetch, loginAdmin } from './adminApi';

describe('adminApi', () => {
	afterEach(() => {
		vi.restoreAllMocks();
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

	it('WEB-ADM-13: logoutAdmin uses credentials include', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ok: true }),
		});
		vi.stubGlobal('fetch', fetchMock);

		const { logoutAdmin } = await import('./adminApi');
		await logoutAdmin();

		expect(fetchMock).toHaveBeenCalledWith(
			'/api/admin/auth/logout',
			expect.objectContaining({ credentials: 'include', method: 'POST' }),
		);
	});

	it('WEB-ADM-14: getAdminMe uses credentials include', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ admin: { id: '1', username: 'admin' } }),
		});
		vi.stubGlobal('fetch', fetchMock);

		const { getAdminMe } = await import('./adminApi');
		await getAdminMe();

		expect(fetchMock).toHaveBeenCalledWith(
			'/api/admin/auth/me',
			expect.objectContaining({ credentials: 'include' }),
		);
	});

	it('WEB-ADM-16: AdminApiError exposes statusCode', async () => {
		const error = new AdminApiError(429, 'Too many login attempts');
		expect(error.statusCode).toBe(429);
		expect(error.message).toBe('Too many login attempts');
	});
});
