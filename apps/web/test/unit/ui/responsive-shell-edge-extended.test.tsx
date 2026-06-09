import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminDashboardResponseDto } from '@nestidp/shared';
import {
	ADMIN_USERS_ROUTE_PREFIX,
	AUDIT_ROUTE_PREFIX,
	IDP_SETTINGS_ROUTE_PREFIX,
} from '@nestidp/shared';
import * as adminApi from '@/admin/adminApi';
import { ApiConnectionsListPage } from '@/admin/pages/ApiConnectionsListPage';
import { AuditLogPage } from '@/admin/pages/AuditLogPage';
import { DashboardPage } from '@/admin/pages/DashboardPage';
import { IdpSettingsPage } from '@/admin/pages/IdpSettingsPage';
import { SpConnectionsListPage } from '@/admin/pages/SpConnectionsListPage';
import { SyncLogDetailPage } from '@/admin/pages/SyncLogDetailPage';
import { AppShell } from '@/ui/AppShell';
import { SidebarNav } from '@/ui/SidebarNav';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { evergreenDir, webRoot, webSrc } from '@test/helpers/paths';

const uiDir = join(webSrc, 'ui');

const dashboardStub: AdminDashboardResponseDto = {
	counts: { users: 1, groups: 1, roles: 1, apiConnections: 1, spConnections: 1 },
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
		signingKeyFamily: 'rsa',
		signingSignatureAlgorithmId: 'rsa-sha256',
		signingRsaModulusBits: 2048,
		signingEcCurve: null,
		certStatus: 'ok',
		hasEncryptionCertificate: false,
		encryptionRotationActive: false,
		encryptionCertNotAfter: null,
		encryptionKeyFamily: null,
		encryptionKeyTransportAlgorithmId: null,
		encryptionRsaModulusBits: null,
		encryptionEcCurve: null,
		encryptionCertStatus: 'not_configured' as const,
	},
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
};

function renderInShell(ui: ReactElement) {
	return renderWithUi(
		<MemoryRouter>
			<AppShell operatorUsername="admin" onLogout={vi.fn()}>
				{ui}
			</AppShell>
		</MemoryRouter>,
	);
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	document.body.style.overflow = '';
});

describe('Responsive shell — extended component (WEB-RSP-40–69)', () => {
	it('WEB-RSP-40: shell root has evg-shell--with-sidebar', () => {
		const { container } = render(
			<MemoryRouter>
				<AppShell operatorUsername={null} onLogout={vi.fn()}>
					<p>x</p>
				</AppShell>
			</MemoryRouter>,
		);
		expect(container.querySelector('.evg-shell.evg-shell--with-sidebar')).not.toBeNull();
	});

	it('WEB-RSP-41: sidebar id evg-sidebar matches aria-controls on burger', () => {
		render(
			<MemoryRouter>
				<AppShell operatorUsername="admin" onLogout={vi.fn()}>
					<p>x</p>
				</AppShell>
			</MemoryRouter>,
		);
		expect(document.getElementById('evg-sidebar')).not.toBeNull();
		expect(screen.getByTestId('evg-mobile-nav-toggle').getAttribute('aria-controls')).toBe(
			'evg-sidebar',
		);
	});

	it('WEB-RSP-42: logout still callable when drawer closed', () => {
		const onLogout = vi.fn();
		render(
			<MemoryRouter>
				<AppShell operatorUsername="admin" onLogout={onLogout}>
					<p>x</p>
				</AppShell>
			</MemoryRouter>,
		);
		fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
		expect(onLogout).toHaveBeenCalledTimes(1);
	});

	it('WEB-RSP-43: repeated Escape with drawer closed does not error', () => {
		render(
			<MemoryRouter>
				<AppShell operatorUsername="admin" onLogout={vi.fn()}>
					<p>x</p>
				</AppShell>
			</MemoryRouter>,
		);
		fireEvent.keyDown(window, { key: 'Escape' });
		fireEvent.keyDown(window, { key: 'Escape' });
		expect(screen.getByTestId('evg-sidebar').className).not.toContain('evg-sidebar--open');
	});

	it('WEB-RSP-44: scrim has accessible close label', () => {
		render(
			<MemoryRouter>
				<AppShell operatorUsername="admin" onLogout={vi.fn()}>
					<p>x</p>
				</AppShell>
			</MemoryRouter>,
		);
		fireEvent.click(screen.getByRole('button', { name: /menu/i }));
		expect(screen.getByRole('button', { name: 'Close menu' })).toBeDefined();
	});

	it('WEB-RSP-45: topbar contains mobile toggle and session bar when authenticated', () => {
		const { container } = render(
			<MemoryRouter>
				<AppShell operatorUsername="operator" onLogout={vi.fn()}>
					<p>x</p>
				</AppShell>
			</MemoryRouter>,
		);
		const topbar = container.querySelector('.evg-topbar');
		expect(topbar?.querySelector('[data-testid="evg-mobile-nav-toggle"]')).not.toBeNull();
		expect(screen.getAllByText(/operator/).length).toBeGreaterThan(0);
	});

	it('WEB-RSP-46: null operator shows operator console in topbar', () => {
		render(
			<MemoryRouter>
				<AppShell operatorUsername={null} onLogout={vi.fn()}>
					<p>x</p>
				</AppShell>
			</MemoryRouter>,
		);
		expect(screen.getByText('Operator console')).toBeDefined();
	});

	it('WEB-RSP-47: SidebarNav SP connections link closes drawer via onNavigate', () => {
		render(
			<MemoryRouter>
				<AppShell operatorUsername="admin" onLogout={vi.fn()}>
					<p>x</p>
				</AppShell>
			</MemoryRouter>,
		);
		const sidebar = screen.getByTestId('evg-sidebar');
		fireEvent.click(screen.getByRole('button', { name: /menu/i }));
		fireEvent.click(screen.getByRole('link', { name: 'SP connections' }));
		expect(sidebar.className).not.toContain('evg-sidebar--open');
	});

	it('WEB-RSP-48: AppShell does not import LanguageSelect in topbar', () => {
		const src = readFileSync(join(uiDir, 'AppShell.tsx'), 'utf8');
		expect(src).not.toContain('LanguageSelect');
	});

	it('WEB-RSP-49: SidebarNav includes LanguageSelect in footer', () => {
		const src = readFileSync(join(uiDir, 'SidebarNav.tsx'), 'utf8');
		expect(src).toContain('LanguageSelect');
		expect(src).toContain('evg-sidebar-footer');
	});
});

describe('Responsive shell — extended integration (WEB-RSP-100–115)', () => {
	it('WEB-RSP-100: Dashboard inside AppShell renders shell-body and heading', async () => {
		vi.spyOn(adminApi, 'getAdminDashboard').mockResolvedValue(dashboardStub);
		const { container } = renderInShell(<DashboardPage />);
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeDefined();
		});
		expect(container.querySelector('.evg-shell-body')).not.toBeNull();
	});

	it('WEB-RSP-101: API connections list inside shell has table wrap when data', async () => {
		vi.spyOn(adminApi, 'listApiConnections').mockResolvedValue({
			connections: [
				{
					id: 'c1',
					name: 'Ext',
					baseUrl: 'https://api.example.com',
					lastSyncStatus: 'SUCCESS',
				},
			],
		});
		const { container } = renderInShell(<ApiConnectionsListPage />);
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'API connections' })).toBeDefined();
		});
		expect(container.querySelector('.evg-table-wrap')).not.toBeNull();
	});

	it('WEB-RSP-102: SP connections list inside shell has page header', async () => {
		vi.spyOn(adminApi, 'listSpConnections').mockResolvedValue({ items: [] });
		const { container } = renderInShell(<SpConnectionsListPage />);
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'SP connections' })).toBeDefined();
		});
		expect(container.querySelector('.evg-page-header')).not.toBeNull();
	});

	it('WEB-RSP-103: Audit log inside shell renders filters panel', async () => {
		vi.spyOn(adminApi, 'listAuditEvents').mockResolvedValue({
			items: [],
			total: 0,
			limit: 50,
			offset: 0,
		});
		renderInShell(<AuditLogPage />);
		await waitFor(() => {
			expect(document.querySelector('.evg-filters-panel')).not.toBeNull();
		});
	});

	it('WEB-RSP-104: IdP settings inside shell renders inside evg-main', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue({
			entityId: 'http://localhost:3000',
			nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			wantAuthnRequestsSigned: false,
			hasSigningCertificate: true,
			signingCertFingerprintSha256: 'aa',
			signingCertNotAfter: '2030-01-01T00:00:00.000Z',
			metadataUrl: 'http://localhost:3000/saml/metadata',
			ssoUrl: 'http://localhost:3000/saml/sso',
			idpBaseUrl: 'http://localhost:3000',
			rotation: {
				active: false,
				startedAt: null,
				hasPendingCertificate: false,
				pendingCertFingerprintSha256: null,
				pendingSigningKeyFamily: null,
				pendingSigningSignatureAlgorithmId: null,
				pendingSigningRsaModulusBits: null,
				pendingSigningEcCurve: null,
				pendingSigningCertNotAfter: null,
				auto: {
					enabled: false,
					disabledAt: null,
					consecutiveFailures: 0,
					lastError: null,
					willAutoStartBy: null,
					willAutoCompleteAt: null,
				},
			},
			hasEncryptionCertificate: false,
			encryptionCertFingerprintSha256: null,
			encryptionCertNotAfter: null,
			encryptionKeyFamily: null,
			encryptionKeyTransportAlgorithmId: null,
			encryptionRsaModulusBits: null,
			encryptionEcCurve: null,
			encryptionRotation: {
				active: false,
				startedAt: null,
				hasPendingCertificate: false,
				pendingCertFingerprintSha256: null,
				pendingEncryptionKeyFamily: null,
				pendingEncryptionKeyTransportAlgorithmId: null,
				pendingEncryptionRsaModulusBits: null,
				pendingEncryptionEcCurve: null,
				pendingEncryptionCertNotAfter: null,
				auto: {
					enabled: false,
					disabledAt: null,
					consecutiveFailures: 0,
					lastError: null,
					willAutoStartBy: null,
					willAutoCompleteAt: null,
				},
			},
			updatedAt: '2026-01-01T00:00:00.000Z',
		});
		renderInShell(<IdpSettingsPage />);
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'IdP settings' })).toBeDefined();
		});
		expect(document.querySelector('#evg-main .evg-container')).not.toBeNull();
	});

	it('WEB-RSP-105: Sync log detail inside shell uses CodeBlock', async () => {
		vi.spyOn(adminApi, 'getSyncLog').mockResolvedValue({
			syncLog: {
				id: 'log-1',
				status: 'SUCCESS',
				startedAt: '2026-01-01T00:00:00.000Z',
				finishedAt: '2026-01-01T00:01:00.000Z',
				dryRun: false,
				errors: [{ message: 'sample' }],
			},
		});
		renderWithUi(
			<MemoryRouter initialEntries={['/admin/sync-logs/log-1']}>
				<AppShell operatorUsername="admin" onLogout={vi.fn()}>
					<Routes>
						<Route path="/admin/sync-logs/:syncLogId" element={<SyncLogDetailPage />} />
					</Routes>
				</AppShell>
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(document.querySelector('.evg-code-block')).not.toBeNull();
		});
	});

	it('WEB-RSP-106: drawer open keeps dashboard heading in DOM (aria-hidden)', async () => {
		vi.spyOn(adminApi, 'getAdminDashboard').mockResolvedValue(dashboardStub);
		const { container } = renderInShell(<DashboardPage />);
		await waitFor(() => screen.getByRole('heading', { name: 'Dashboard' }));
		fireEvent.click(screen.getByRole('button', { name: /menu/i }));
		expect(container.querySelector('#evg-main')?.textContent).toContain('Dashboard');
	});

	it('WEB-RSP-107: SidebarNav alone exposes 44px min-height nav links', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toMatch(/\.evg-nav__link[\s\S]*min-height:\s*44px/);
		renderWithUi(
			<MemoryRouter>
				<SidebarNav operatorUsername="admin" onLogout={vi.fn()} />
			</MemoryRouter>,
		);
		expect(screen.getByRole('navigation', { name: 'Admin' })).toBeDefined();
	});

	it('WEB-RSP-108: opening drawer twice keeps single scrim', () => {
		const { container } = render(
			<MemoryRouter>
				<AppShell operatorUsername="admin" onLogout={vi.fn()}>
					<p>x</p>
				</AppShell>
			</MemoryRouter>,
		);
		const toggle = screen.getByRole('button', { name: /menu/i });
		fireEvent.click(toggle);
		fireEvent.click(toggle);
		fireEvent.click(toggle);
		expect(container.querySelectorAll('.evg-drawer-scrim').length).toBe(1);
	});

	it('WEB-RSP-109: body overflow not locked when drawer closed after open-close', () => {
		render(
			<MemoryRouter>
				<AppShell operatorUsername="admin" onLogout={vi.fn()}>
					<p>x</p>
				</AppShell>
			</MemoryRouter>,
		);
		const toggle = screen.getByRole('button', { name: /menu/i });
		fireEvent.click(toggle);
		fireEvent.click(toggle);
		expect(document.body.style.overflow).toBe('');
	});

	it('WEB-RSP-110: AppShell matchMedia guarded for test environments', () => {
		const src = readFileSync(join(uiDir, 'AppShell.tsx'), 'utf8');
		expect(src).toContain("typeof window.matchMedia !== 'function'");
	});

	it('WEB-RSP-111: AdminLayout wraps AppShell with ToastProvider', () => {
		const src = readFileSync(join(webSrc, 'admin/AdminLayout.tsx'), 'utf8');
		expect(src).toMatch(/ToastProvider[\s\S]*AppShell/);
	});

	it('WEB-RSP-112: AdminLayout loading branch uses evg-auth-layout without AppShell', () => {
		const src = readFileSync(join(webSrc, 'admin/AdminLayout.tsx'), 'utf8');
		const match = src.match(/if \(authState === 'loading'\) \{[\s\S]*?\n\t\}/);
		expect(match).not.toBeNull();
		expect(match![0]).toContain('evg-auth-layout');
		expect(match![0]).not.toContain('AppShell');
	});

	it('WEB-RSP-113: LoginPage does not use AppShell', () => {
		const src = readFileSync(join(webSrc, 'login/LoginPage.tsx'), 'utf8');
		expect(src).not.toContain('AppShell');
		expect(src).toContain('evg-auth-layout');
	});

	it('WEB-RSP-114: AdminLoginPage does not use AppShell', () => {
		const src = readFileSync(join(webSrc, 'admin/AdminLoginPage.tsx'), 'utf8');
		expect(src).not.toContain('AppShell');
	});

	it('WEB-RSP-115: extended responsive test files exist', () => {
		expect(existsSync(join(webRoot, 'test/unit/ui/responsive-shell-edge-extended.test.tsx'))).toBe(
			true,
		);
		expect(existsSync(join(webRoot, 'test/unit/ui/responsive-shell-edge-extended.test.ts'))).toBe(
			true,
		);
	});
});
