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
import * as adminApi from '@/admin/adminApi';
import { DashboardPage } from '@/admin/pages/DashboardPage';

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
		spSecurity: {
			spConnectionsRequireSignedAuthn: 0,
			spConnectionsRequireEncryptedAssertions: 0,
			spConnectionsMissingCertWithSecurityFlags: 0,
			idpAdvertisesSignedAuthnRequests: false,
			idpEncryptionKeyIsEc: false,
			activeSamlSessions: 0,
			backchannelUnresolved: 0,
		},
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
		oauthTokenUrl: null,
		oauthClientId: null,
		oauthScope: null,
		oauthAudience: null,
		oauthClientAuthMethod: null,
		oauthTokenRequestParams: null,
		hasOauthClientSecret: false,
		oauthLastTokenAt: null,
		proxyEnabled: false,
		proxyUrl: null,
		proxyUsername: null,
		hasProxyPassword: false,
		noProxyHosts: null,
		lastProxyCheckStatus: null,
		lastProxyCheckAt: null,
		apiContractConfig: null,
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
