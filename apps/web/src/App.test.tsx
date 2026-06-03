import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
	ADMIN_USERS_ROUTE_PREFIX,
	AUDIT_ROUTE_PREFIX,
	IDP_SETTINGS_ROUTE_PREFIX,
	type AdminDashboardResponseDto,
} from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './AppRoutes';
import * as adminApi from './admin/adminApi';

const dashboardStub: AdminDashboardResponseDto = {
	counts: { users: 0, groups: 0, roles: 0, apiConnections: 0, spConnections: 0 },
	apiConnectionsRoute: '/admin/api-connections',
	spConnectionsRoute: '/admin/sp-connections',
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
	getAdminDashboard: vi.fn(),
	listApiConnections: vi.fn(),
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

function mockAuthenticatedAdmin() {
	vi.mocked(adminApi.getAdminMe).mockResolvedValue({
		admin: { id: '1', username: 'admin' },
		csrfToken: 'test-csrf-token',
	});
	vi.mocked(adminApi.getAdminDashboard).mockResolvedValue(dashboardStub);
}

describe('App routing', () => {
	it('renders admin shell at /admin when authenticated', async () => {
		mockAuthenticatedAdmin();
		renderAt('/admin');
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'NestIdP' })).toBeDefined();
			expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeDefined();
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
		mockAuthenticatedAdmin();
		const { unmount } = renderAt('/admin');
		await waitFor(() => screen.getByRole('heading', { name: 'NestIdP' }));
		expect(screen.queryByRole('heading', { name: 'SAML Login' })).toBeNull();
		unmount();
		renderAt('/login');
		expect(screen.queryByRole('heading', { name: 'NestIdP' })).toBeNull();
	});

	it('renders nested admin sub-routes when authenticated', async () => {
		mockAuthenticatedAdmin();
		vi.mocked(adminApi.listApiConnections).mockResolvedValue({ connections: [] });
		renderAt('/admin/api-connections');
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'API connections' })).toBeDefined();
		});
	});

	it('does not expose API stub JSON in the UI', async () => {
		mockAuthenticatedAdmin();
		renderAt('/admin');
		await waitFor(() => screen.getByRole('heading', { name: 'Dashboard' }));
		expect(screen.queryByText(/"status":\s*"stub"/)).toBeNull();
	});
});
