import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
	ADMIN_USERS_ROUTE_PREFIX,
	AUDIT_ROUTE_PREFIX,
	IDP_SETTINGS_ROUTE_PREFIX,
	type AdminDashboardResponseDto,
	type ApiConnectionDto,
} from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '../adminApi';
import { DashboardPage } from './DashboardPage';

const defaultIdp = {
	idpSettingsRoute: IDP_SETTINGS_ROUTE_PREFIX,
	hasSigningCertificate: true,
	rotationActive: false,
	signingCertNotAfter: '2030-01-01T00:00:00.000Z',
	certStatus: 'ok' as const,
};

function dashboardStub(
	overrides: Partial<AdminDashboardResponseDto> = {},
): AdminDashboardResponseDto {
	return {
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
		idp: defaultIdp,
		apiConnection: null,
		lastSyncStatus: null,
		lastSyncAt: null,
		auditEventsRoute: AUDIT_ROUTE_PREFIX,
		adminUsersRoute: ADMIN_USERS_ROUTE_PREFIX,
		...overrides,
	};
}

function apiConnectionStub(overrides: Partial<ApiConnectionDto> = {}): ApiConnectionDto {
	return {
		id: 'c1',
		name: 'HR',
		baseUrl: 'https://api.example.com',
		authType: 'BEARER',
		hasBearerToken: true,
		lastSyncAt: null,
		lastSyncStatus: 'NEVER',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('DashboardPage Evergreen edge cases', () => {
	it('WEB-EVG-67: last sync badge uses mapper for FAILED status', async () => {
		vi.spyOn(adminApi, 'getAdminDashboard').mockResolvedValue(
			dashboardStub({
				apiConnection: apiConnectionStub(),
				lastSyncStatus: 'FAILED',
			}),
		);

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			const badge = document.querySelector('.evg-badge--danger');
			expect(badge?.textContent).toBe('FAILED');
		});
	});

	it('WEB-EVG-68: shows create API connection CTA when no identity source', async () => {
		vi.spyOn(adminApi, 'getAdminDashboard').mockResolvedValue(dashboardStub());

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText(/No API connection yet/i)).toBeDefined();
			expect(screen.getByRole('link', { name: /Create one/i }).getAttribute('href')).toContain(
				'/admin/api-connections/new',
			);
		});
	});

	it('WEB-EVG-69: cert badge uses human-readable label via certStatusLabel', async () => {
		vi.spyOn(adminApi, 'getAdminDashboard').mockResolvedValue(
			dashboardStub({
				idp: { ...defaultIdp, certStatus: 'expiring_soon' },
			}),
		);

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('Expiring soon')).toBeDefined();
			expect(document.querySelector('.evg-badge--warning')).toBeDefined();
		});
	});
});
