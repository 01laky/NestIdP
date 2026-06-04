import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { renderWithUi } from '../test/renderWithUi';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ADMIN_USERS_ROUTE_PREFIX,
	API_CONNECTION_ROUTE_PREFIX,
	AUDIT_ROUTE_PREFIX,
	IDP_SETTINGS_ROUTE_PREFIX,
	SP_CONNECTION_ROUTE_PREFIX,
	type AdminDashboardResponseDto,
} from '@nestidp/shared';
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

const dashboardStub: AdminDashboardResponseDto = {
	counts: { users: 0, groups: 0, roles: 0, apiConnections: 0, spConnections: 0 },
	apiConnectionsRoute: API_CONNECTION_ROUTE_PREFIX,
	spConnectionsRoute: SP_CONNECTION_ROUTE_PREFIX,
	identityUsersRoute: '/admin/identity/users',
	apiConnectionsApiPath: '/api/admin/api-connections',
	syncApiPath: '/api/admin/sync',
	spConnectionsApiPath: '/api/admin/sp-connections',
	metadataUrl: 'http://localhost:3000/saml/metadata',
	entityId: 'http://localhost:3000',
	ssoUrl: 'http://localhost:3000/saml/sso',
	idp: {
		idpSettingsRoute: IDP_SETTINGS_ROUTE_PREFIX,
		hasSigningCertificate: true,
		rotationActive: false,
		signingCertNotAfter: '2030-01-01T00:00:00.000Z',
		certStatus: 'ok' as const,
	},
	apiConnection: null,
	lastSyncStatus: null,
	lastSyncAt: null,
	auditEventsRoute: AUDIT_ROUTE_PREFIX,
	adminUsersRoute: ADMIN_USERS_ROUTE_PREFIX,
};

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
			expect(screen.getByTestId('navigate').textContent).toBe(
				'/admin/login?reason=session_expired',
			);
		});
		expect(logoutSpy).toHaveBeenCalled();
	});

	it('WEB-ADM-RM-16: unauthenticated Navigate includes session_expired reason', async () => {
		vi.spyOn(adminApi, 'logoutAdmin').mockResolvedValue({ ok: true });
		vi.spyOn(adminApi, 'getAdminMe').mockRejectedValue(
			new adminApi.AdminApiError(401, 'Unauthorized'),
		);
		renderAdminAt('/admin');
		await waitFor(() => {
			expect(screen.getByTestId('navigate').textContent).toContain('session_expired');
		});
	});

	it('WEB-ADM-RM-29: non-401 getAdminMe error still redirects with session_expired', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockRejectedValue(
			new adminApi.AdminApiError(500, 'Internal error'),
		);
		const logoutSpy = vi.spyOn(adminApi, 'logoutAdmin');
		renderAdminAt('/admin');
		await waitFor(() => {
			expect(screen.getByTestId('navigate').textContent).toContain('session_expired');
		});
		expect(logoutSpy).not.toHaveBeenCalled();
	});

	it('WEB-ADM-09: clears stale session via logout on 401', async () => {
		const logoutSpy = vi.spyOn(adminApi, 'logoutAdmin').mockResolvedValue({ ok: true });
		vi.spyOn(adminApi, 'getAdminMe').mockRejectedValue(
			new adminApi.AdminApiError(401, 'Unauthorized'),
		);

		renderAdminAt('/admin');
		await waitFor(() => expect(logoutSpy).toHaveBeenCalled());
	});

	it('WEB-ADM-20: renders sidebar brand when authenticated', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: '1', username: 'admin' },
			csrfToken: 'test-csrf-token',
		});
		vi.spyOn(adminApi, 'getAdminDashboard').mockResolvedValue(dashboardStub);

		renderAdminAt('/admin');

		await waitFor(() => {
			expect(screen.getByRole('link', { name: /NestIdP/i })).toBeDefined();
		});
	});

	it('WEB-ADM-05: logout button calls logout endpoint', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: '1', username: 'admin' },
			csrfToken: 'test-csrf-token',
		});
		vi.spyOn(adminApi, 'getAdminDashboard').mockResolvedValue(dashboardStub);
		const logoutSpy = vi.spyOn(adminApi, 'logoutAdmin').mockResolvedValue({ ok: true });

		renderAdminAt('/admin');
		await waitFor(() => screen.getByRole('button', { name: 'Logout' }));
		screen.getByRole('button', { name: 'Logout' }).click();

		await waitFor(() => {
			expect(logoutSpy).toHaveBeenCalled();
			expect(navigateMock).toHaveBeenCalledWith('/admin/login', { replace: true });
		});
	});

	it('WEB-ADM-21: sidebar links to API and SP sections', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: '1', username: 'admin' },
			csrfToken: 'test-csrf-token',
		});
		vi.spyOn(adminApi, 'getAdminDashboard').mockResolvedValue(dashboardStub);

		renderAdminAt('/admin');

		await waitFor(() => {
			expect(screen.getByRole('link', { name: 'API connections' }).getAttribute('href')).toBe(
				API_CONNECTION_ROUTE_PREFIX,
			);
			expect(screen.getByRole('link', { name: 'SP connections' }).getAttribute('href')).toBe(
				SP_CONNECTION_ROUTE_PREFIX,
			);
		});
	});

	it('WEB-ADM-22: nested api-connections route renders list page', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: '1', username: 'admin' },
			csrfToken: 'test-csrf-token',
		});
		vi.spyOn(adminApi, 'listApiConnections').mockResolvedValue({ connections: [] });

		renderAdminAt('/admin/api-connections');
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'API connections' })).toBeDefined();
		});
	});

	it('WEB-EVG-99: nested api-connections/new renders labeled Name field', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: '1', username: 'admin' },
			csrfToken: 'test-csrf-token',
		});

		renderWithUi(
			<MemoryRouter initialEntries={['/admin/api-connections/new']}>
				<Routes>
					<Route path="/admin/*" element={<AdminLayout />} />
				</Routes>
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByLabelText(/^Name/i)).toBeDefined();
		});
	});

	it('WEB-ADM-23: links to SAML login page when authenticated', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: '1', username: 'admin' },
			csrfToken: 'test-csrf-token',
		});
		vi.spyOn(adminApi, 'getAdminDashboard').mockResolvedValue(dashboardStub);

		renderAdminAt('/admin');
		await waitFor(() => {
			const link = screen.getByRole('link', { name: 'SAML login' });
			expect(link.getAttribute('href')).toBe('/login');
		});
	});
});
