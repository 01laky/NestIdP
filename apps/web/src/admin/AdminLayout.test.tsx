import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_CONNECTION_ROUTE_PREFIX, SP_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminLayout } from './AdminLayout';
import * as adminApi from './adminApi';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
	const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
	return {
		...actual,
		useNavigate: () => navigateMock,
		Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
	};
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	navigateMock.mockReset();
});

function renderAdminAt(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/admin/*" element={<AdminLayout />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('AdminLayout', () => {
	it('WEB-ADM-15: shows loading state while checking session', () => {
		vi.spyOn(adminApi, 'getAdminMe').mockImplementation(
			() =>
				new Promise(() => {
					/* never resolves */
				}),
		);

		renderAdminAt('/admin');
		expect(screen.getByText(/Loading admin session/i)).toBeDefined();
	});

	it('WEB-ADM-03: redirects when unauthenticated', async () => {
		const logoutSpy = vi.spyOn(adminApi, 'logoutAdmin').mockResolvedValue({ ok: true });
		vi.spyOn(adminApi, 'getAdminMe').mockRejectedValue(
			new adminApi.AdminApiError(401, 'Unauthorized'),
		);

		renderAdminAt('/admin');

		await waitFor(() => {
			expect(screen.getByTestId('navigate').textContent).toBe('/admin/login');
		});
		expect(logoutSpy).toHaveBeenCalled();
	});

	it('WEB-ADM-09: clears stale session via logout on 401', async () => {
		const logoutSpy = vi.spyOn(adminApi, 'logoutAdmin').mockResolvedValue({ ok: true });
		vi.spyOn(adminApi, 'getAdminMe').mockRejectedValue(
			new adminApi.AdminApiError(401, 'Unauthorized'),
		);

		renderAdminAt('/admin');
		await waitFor(() => expect(logoutSpy).toHaveBeenCalled());
	});

	it('renders admin heading when authenticated', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: '1', username: 'admin' },
		});

		renderAdminAt('/admin');

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'NestIdP Admin' })).toBeDefined();
		});
	});

	it('WEB-ADM-05: logout button calls logout endpoint', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: '1', username: 'admin' },
		});
		const logoutSpy = vi.spyOn(adminApi, 'logoutAdmin').mockResolvedValue({ ok: true });

		renderAdminAt('/admin');
		await waitFor(() => screen.getByRole('button', { name: 'Logout' }));
		screen.getByRole('button', { name: 'Logout' }).click();

		await waitFor(() => {
			expect(logoutSpy).toHaveBeenCalled();
			expect(navigateMock).toHaveBeenCalledWith('/admin/login', { replace: true });
		});
	});

	it('shows separate API and SP connection route prefixes when authenticated', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: '1', username: 'admin' },
		});

		renderAdminAt('/admin');

		await waitFor(() => {
			expect(screen.getByText(API_CONNECTION_ROUTE_PREFIX)).toBeDefined();
			expect(screen.getByText(SP_CONNECTION_ROUTE_PREFIX)).toBeDefined();
		});
	});

	it('renders sub-route placeholder for nested admin paths when authenticated', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: '1', username: 'admin' },
		});

		renderAdminAt('/admin/api-connections');
		await waitFor(() => {
			expect(screen.getByText(/Admin sub-route placeholder/)).toBeDefined();
		});
	});

	it('links to SAML login page when authenticated', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: '1', username: 'admin' },
		});

		renderAdminAt('/admin');
		await waitFor(() => {
			const link = screen.getByRole('link', { name: 'Go to SAML login page' });
			expect(link.getAttribute('href')).toBe('/login');
		});
	});
});
