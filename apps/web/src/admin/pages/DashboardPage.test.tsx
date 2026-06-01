import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '../adminApi';
import { DashboardPage } from './DashboardPage';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('DashboardPage', () => {
	it('WEB-ADM-30: shows loading then dashboard stats', async () => {
		vi.spyOn(adminApi, 'getAdminDashboard').mockResolvedValue({
			counts: { users: 3, groups: 2, roles: 1, apiConnections: 1, spConnections: 4 },
			apiConnectionsRoute: '/admin/api-connections',
			spConnectionsRoute: '/admin/sp-connections',
			identityUsersRoute: '/admin/identity/users',
			apiConnectionsApiPath: '/api/admin/api-connections',
			syncApiPath: '/api/admin/sync',
			spConnectionsApiPath: '/api/admin/sp-connections',
			metadataUrl: 'http://localhost:3000/saml/metadata',
			entityId: 'http://localhost:3000',
			ssoUrl: 'http://localhost:3000/saml/sso',
			apiConnection: null,
			lastSyncStatus: null,
			lastSyncAt: null,
		});

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		expect(screen.getByText(/Loading dashboard/i)).toBeDefined();
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeDefined();
			const values = document.querySelectorAll('.admin-stat-value');
			expect(values[0]?.textContent).toBe('3');
		});
	});

	it('WEB-ADM-31: shows error banner on API failure', async () => {
		vi.spyOn(adminApi, 'getAdminDashboard').mockRejectedValue(
			new adminApi.AdminApiError(500, 'Server error'),
		);

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByRole('alert').textContent).toContain('Server error');
		});
	});
});
