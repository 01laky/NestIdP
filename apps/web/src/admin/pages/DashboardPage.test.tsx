import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
	ADMIN_USERS_ROUTE_PREFIX,
	AUDIT_ROUTE_PREFIX,
	IDP_SETTINGS_ROUTE_PREFIX,
	type AdminDashboardResponseDto,
} from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '../adminApi';
import { DashboardPage } from './DashboardPage';

const defaultIdp = {
	idpSettingsRoute: IDP_SETTINGS_ROUTE_PREFIX,
	hasSigningCertificate: true,
	rotationActive: false,
	signingCertNotAfter: '2030-01-01T00:00:00.000Z',
	signingKeyFamily: 'rsa' as const,
	signingSignatureAlgorithmId: 'rsa-sha256',
	signingRsaModulusBits: 2048,
	signingEcCurve: null,
	certStatus: 'ok' as const,
	hasEncryptionCertificate: false,
	encryptionRotationActive: false,
	encryptionCertNotAfter: null,
	encryptionKeyFamily: null,
	encryptionKeyTransportAlgorithmId: null,
	encryptionRsaModulusBits: null,
	encryptionEcCurve: null,
	encryptionCertStatus: 'not_configured' as const,
};

function dashboardStub(
	overrides: Partial<AdminDashboardResponseDto> = {},
): AdminDashboardResponseDto {
	return {
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
		idp: defaultIdp,
		apiConnection: null,
		lastSyncStatus: null,
		lastSyncAt: null,
		auditEventsRoute: AUDIT_ROUTE_PREFIX,
		adminUsersRoute: ADMIN_USERS_ROUTE_PREFIX,
		...overrides,
	};
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('DashboardPage', () => {
	it('WEB-ADM-30: shows loading then dashboard stats', async () => {
		vi.spyOn(adminApi, 'getAdminDashboard').mockResolvedValue(dashboardStub());

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		expect(screen.getByText(/Loading dashboard/i)).toBeDefined();
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeDefined();
			expect(document.querySelector('.evg-stats-grid')).toBeDefined();
			const values = document.querySelectorAll('.evg-stat__value');
			expect(values[0]?.textContent).toBe('3');
		});
	});

	it('WEB-EVG-08: dashboard renders stat grid with evg-stat', async () => {
		vi.spyOn(adminApi, 'getAdminDashboard').mockResolvedValue(dashboardStub());

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(document.querySelector('.evg-stats-grid.evg-stats-grid--dashboard')).toBeDefined();
			expect(document.querySelectorAll('.evg-stat').length).toBeGreaterThan(0);
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

	it('WEB-DASH-ENC-01: dashboard renders idpEncryptionSummary when encryption configured', async () => {
		vi.spyOn(adminApi, 'getAdminDashboard').mockResolvedValue(
			dashboardStub({
				idp: {
					...defaultIdp,
					hasEncryptionCertificate: true,
					encryptionCertStatus: 'ok',
					encryptionKeyFamily: 'rsa',
					encryptionKeyTransportAlgorithmId: 'rsa-oaep-mgf1p',
					encryptionRsaModulusBits: 3072,
					encryptionCertNotAfter: '2031-06-01T00:00:00.000Z',
				},
			}),
		);

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText(/Encryption: RSA 3072 bit · rsa-oaep-mgf1p/i)).toBeDefined();
		});
	});

	it('WEB-DASH-CRYPTO-01: dashboard renders idpSigningSummary when cert configured', async () => {
		vi.spyOn(adminApi, 'getAdminDashboard').mockResolvedValue(dashboardStub());

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText(/RSA 2048 bit · rsa-sha256 · expires/i)).toBeDefined();
		});
	});

	it('WEB-ADM-61: renders Configure IdP settings link to /admin/settings/idp', async () => {
		vi.spyOn(adminApi, 'getAdminDashboard').mockResolvedValue(dashboardStub());

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			const link = screen.getByRole('link', { name: 'Configure IdP settings' });
			expect(link.getAttribute('href')).toBe(IDP_SETTINGS_ROUTE_PREFIX);
		});
	});

	it('WEB-ADM-62: badge No signing cert when idp.certStatus is missing', async () => {
		vi.spyOn(adminApi, 'getAdminDashboard').mockResolvedValue(
			dashboardStub({
				idp: {
					...defaultIdp,
					hasSigningCertificate: false,
					certStatus: 'missing',
				},
			}),
		);

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('No signing cert')).toBeDefined();
		});
	});

	it('WEB-ADM-63: badge Rotation in progress when idp.certStatus is rotation_active', async () => {
		vi.spyOn(adminApi, 'getAdminDashboard').mockResolvedValue(
			dashboardStub({
				idp: {
					...defaultIdp,
					rotationActive: true,
					certStatus: 'rotation_active',
				},
			}),
		);

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('Rotation in progress')).toBeDefined();
			expect(screen.getByText(/Complete or cancel signing certificate rotation/i)).toBeDefined();
		});
	});

	it('WEB-ADM-64: shows expiry hint when certStatus is expiring_soon', async () => {
		vi.spyOn(adminApi, 'getAdminDashboard').mockResolvedValue(
			dashboardStub({
				idp: {
					...defaultIdp,
					certStatus: 'expiring_soon',
					signingCertNotAfter: '2026-06-15T00:00:00.000Z',
				},
			}),
		);

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(
				screen.getByText(/Signing certificate expires on 2026-06-15T00:00:00.000Z/i),
			).toBeDefined();
		});
	});

	it('WEB-ADM-65: existing stats and IdP configuration panel still render', async () => {
		vi.spyOn(adminApi, 'getAdminDashboard').mockResolvedValue(dashboardStub());

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeDefined();
			expect(screen.getByRole('heading', { name: 'IdP configuration' })).toBeDefined();
			expect(screen.getByText('http://localhost:3000/saml/metadata')).toBeDefined();
			expect(document.querySelectorAll('.evg-stat__value').length).toBe(5);
		});
	});
});
