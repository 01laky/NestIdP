import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './AppRoutes';
import * as adminApi from './admin/adminApi';

vi.mock('./admin/adminApi', () => ({
	AdminApiError: class AdminApiError extends Error {
		constructor(
			public statusCode: number,
			message: string,
		) {
			super(message);
		}
	},
	getAdminMe: vi.fn(),
	loginAdmin: vi.fn(),
	logoutAdmin: vi.fn(),
	adminFetch: vi.fn(),
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function renderAt(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<AppRoutes />
		</MemoryRouter>,
	);
}

describe('App routing', () => {
	it('renders admin placeholder at /admin when authenticated', async () => {
		vi.mocked(adminApi.getAdminMe).mockResolvedValue({
			admin: { id: '1', username: 'admin' },
			csrfToken: 'test-csrf-token',
		});
		renderAt('/admin');
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'NestIdP Admin' })).toBeDefined();
		});
	});

	it('renders admin login at /admin/login', async () => {
		vi.mocked(adminApi.getAdminMe).mockRejectedValue(
			new adminApi.AdminApiError(401, 'Unauthorized'),
		);
		renderAt('/admin/login');
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Admin Login' })).toBeDefined();
		});
	});

	it('WEB-ADM-04: /admin/login route separate from /login', async () => {
		vi.mocked(adminApi.getAdminMe).mockRejectedValue(
			new adminApi.AdminApiError(401, 'Unauthorized'),
		);
		renderAt('/admin/login');
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Admin Login' })).toBeDefined();
		});
		expect(screen.queryByRole('heading', { name: 'SAML Login' })).toBeNull();
	});

	it('renders login placeholder at /login', () => {
		renderAt('/login');
		expect(screen.getByRole('heading', { name: 'SAML Login' })).toBeDefined();
	});

	it('redirects unauthenticated /admin to login page', async () => {
		vi.mocked(adminApi.getAdminMe).mockRejectedValue(
			new adminApi.AdminApiError(401, 'Unauthorized'),
		);
		vi.mocked(adminApi.logoutAdmin).mockResolvedValue({ ok: true });
		renderAt('/admin');
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Admin Login' })).toBeDefined();
		});
	});

	it('keeps admin and login as separate surfaces', async () => {
		vi.mocked(adminApi.getAdminMe).mockResolvedValue({
			admin: { id: '1', username: 'admin' },
			csrfToken: 'test-csrf-token',
		});
		const { unmount } = renderAt('/admin');
		await waitFor(() => screen.getByRole('heading', { name: 'NestIdP Admin' }));
		expect(screen.queryByRole('heading', { name: 'SAML Login' })).toBeNull();
		unmount();
		renderAt('/login');
		expect(screen.queryByRole('heading', { name: 'NestIdP Admin' })).toBeNull();
	});

	it('renders nested admin sub-routes when authenticated', async () => {
		vi.mocked(adminApi.getAdminMe).mockResolvedValue({
			admin: { id: '1', username: 'admin' },
			csrfToken: 'test-csrf-token',
		});
		renderAt('/admin/api-connections');
		await waitFor(() => {
			expect(screen.getAllByRole('heading', { name: 'NestIdP Admin' }).length).toBe(1);
			expect(screen.getByText(/Admin sub-route placeholder/)).toBeDefined();
		});
	});

	it('does not expose API stub JSON in the UI', async () => {
		vi.mocked(adminApi.getAdminMe).mockResolvedValue({
			admin: { id: '1', username: 'admin' },
			csrfToken: 'test-csrf-token',
		});
		renderAt('/admin');
		await waitFor(() => screen.getByRole('heading', { name: 'NestIdP Admin' }));
		expect(screen.queryByText(/"status":\s*"stub"/)).toBeNull();
	});
});
