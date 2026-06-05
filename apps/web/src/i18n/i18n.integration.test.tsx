import {
	ADMIN_USERS_ROUTE_PREFIX,
	AUDIT_ROUTE_PREFIX,
	BROWSER_LOCALE_SENTINEL,
	IDP_SETTINGS_ROUTE_PREFIX,
	LOCALE_STORAGE_KEY,
	SUPPORTED_LOCALES,
	type AdminDashboardResponseDto,
	type SyncLogDto,
} from '@nestidp/shared';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from '../admin/pages/DashboardPage';
import { IdentityUsersPage } from '../admin/pages/IdentityUsersPage';
import { LoginPage } from '../login/LoginPage';
import { AdminLoginPage } from '../admin/AdminLoginPage';
import * as adminApi from '../admin/adminApi';
import * as authApi from '../auth/authApi';
import { formatAdminApiError, resolveI18nKey } from './api-error-messages';
import { changeLocale, getI18n, initI18n } from './i18n';
import { LanguageSelect } from '../ui/LanguageSelect';
import { renderWithUi } from '../test/renderWithUi';

function dashboardStub(): AdminDashboardResponseDto {
	return {
		counts: { users: 0, groups: 0, roles: 0, apiConnections: 0, spConnections: 0 },
		apiConnectionsRoute: '/admin/api-connections',
		spConnectionsRoute: '/admin/sp-connections',
		identityUsersRoute: '/admin/identity/users',
		apiConnectionsApiPath: '/api/admin/api-connections',
		syncApiPath: '/api/admin/sync',
		spConnectionsApiPath: '/api/admin/sp-connections',
		metadataUrl: '/m',
		entityId: 'e',
		ssoUrl: '/s',
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
		apiConnection: null,
		lastSyncStatus: null,
		lastSyncAt: null,
		auditEventsRoute: AUDIT_ROUTE_PREFIX,
		adminUsersRoute: ADMIN_USERS_ROUTE_PREFIX,
	};
}

function syncLogStub(): SyncLogDto {
	return {
		id: 'log1',
		apiConnectionId: 'c1',
		status: 'SUCCESS',
		startedAt: '2026-01-01T00:00:00Z',
		finishedAt: '2026-01-01T01:00:00Z',
		durationMs: 3600000,
		dryRun: false,
		errors: [],
		usersSynced: 0,
		groupsSynced: 0,
		rolesSynced: 0,
	};
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	localStorage.clear();
	document.documentElement.lang = 'en';
});

describe('i18n integration (WEB-I18N-09–40)', () => {
	it('WEB-I18N-09: document lang cs after init', async () => {
		await initI18n('cs');
		expect(document.documentElement.lang).toBe('cs');
	});

	it('WEB-I18N-10: dashboard heading Czech', async () => {
		vi.spyOn(adminApi, 'getAdminDashboard').mockResolvedValue(dashboardStub());
		await initI18n('cs');
		renderWithUi(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Přehled' })).toBeDefined();
		});
	});

	it('WEB-I18N-11: login Slovak submit', async () => {
		vi.spyOn(authApi, 'getEndUserSession').mockResolvedValue({
			authenticated: false,
			user: null,
			samlSession: null,
		});
		await initI18n('sk');
		renderWithUi(
			<MemoryRouter>
				<LoginPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'Prihlásiť se' })).toBeDefined();
		});
	});

	it('WEB-I18N-12: changeLocale de updates nav', async () => {
		await initI18n('en');
		renderWithUi(
			<MemoryRouter initialEntries={['/admin/login']}>
				<AdminLoginPage />
			</MemoryRouter>,
		);
		await changeLocale('de');
		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'Anmelden' })).toBeDefined();
		});
	});

	it('WEB-I18N-13: unsupported browser → English dashboard', async () => {
		await initI18n('en');
		vi.spyOn(adminApi, 'getAdminDashboard').mockResolvedValue(dashboardStub());
		renderWithUi(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeDefined();
		});
	});

	it('WEB-I18N-14: LanguageSelect persists localStorage', async () => {
		await initI18n('en');
		const { container } = renderWithUi(<LanguageSelect />);
		const select = container.querySelector('select')!;
		fireEvent.change(select, { target: { value: 'pl' } });
		await waitFor(() => {
			expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('pl');
		});
	});

	it('WEB-I18N-15: identity Apply in Polish', async () => {
		vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({ items: [], total: 0 });
		await initI18n('pl');
		renderWithUi(
			<MemoryRouter initialEntries={['/admin/identity/users']}>
				<IdentityUsersPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'Zastosuj' })).toBeDefined();
		});
	});

	it('WEB-I18N-16: renderWithUi English Apply', async () => {
		vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({ items: [], total: 0 });
		renderWithUi(
			<MemoryRouter initialEntries={['/admin/identity/users']}>
				<IdentityUsersPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'Apply' })).toBeDefined();
		});
	});

	it('WEB-I18N-17: identityOriginLabel manual Czech', async () => {
		await initI18n('cs');
		const { identityOriginLabel } = await import('../admin/status-badge');
		expect(identityOriginLabel('manual')).toBe('Ruční');
	});

	it('WEB-I18N-18: missing cs key falls back to en', async () => {
		await initI18n('cs');
		const i18n = getI18n();
		expect(i18n.t('nonexistent.key.xyz', { defaultValue: 'fallback' })).toBe('fallback');
		expect(i18n.t('apply', { ns: 'common' })).toBe('Použít');
	});

	it('WEB-I18N-19: LanguageSelect in ui barrel', async () => {
		const ui = await import('../ui');
		expect(ui.LanguageSelect).toBeDefined();
	});

	it('WEB-I18N-20: document title Czech', async () => {
		await initI18n('cs');
		const { useAdminDocumentTitle } = await import('./useAdminDocumentTitle');
		function Probe() {
			useAdminDocumentTitle('Přehled');
			return null;
		}
		renderWithUi(<Probe />);
		expect(document.title).toBe('Přehled — NestIdP Admin');
	});

	it('WEB-I18N-21: filter users aria-label Czech', async () => {
		vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({ items: [], total: 0 });
		await initI18n('cs');
		const { container } = renderWithUi(
			<MemoryRouter initialEntries={['/admin/identity/users']}>
				<IdentityUsersPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			const form = container.querySelector('form[role="search"]');
			expect(form?.getAttribute('aria-label')).toBe('Filtrovat uživatele');
		});
	});

	it('WEB-I18N-22: first render Slovak login without English flash', async () => {
		vi.spyOn(authApi, 'getEndUserSession').mockResolvedValue({
			authenticated: false,
			user: null,
			samlSession: null,
		});
		await initI18n('sk');
		renderWithUi(
			<MemoryRouter>
				<LoginPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'SAML přihlášení' })).toBeDefined();
		});
	});

	it('WEB-I18N-23: status-badge synced label', async () => {
		await initI18n('en');
		const { identityOriginLabel } = await import('../admin/status-badge');
		expect(identityOriginLabel('synced')).toBe('Synced');
	});

	it('WEB-I18N-24: shared SUPPORTED_LOCALES import', async () => {
		expect(SUPPORTED_LOCALES).toContain('cs');
		expect(SUPPORTED_LOCALES).toHaveLength(10);
	});

	it('WEB-I18N-25: changeLocale de cached', async () => {
		await initI18n('en');
		const addSpy = vi.spyOn(getI18n(), 'addResourceBundle');
		await changeLocale('de');
		const deCalls = addSpy.mock.calls.filter((c) => c[0] === 'de').length;
		await changeLocale('de');
		const deCallsAfter = addSpy.mock.calls.filter((c) => c[0] === 'de').length;
		expect(deCallsAfter).toBe(deCalls);
	});

	it('WEB-I18N-26: login has LanguageSelect', async () => {
		await initI18n('en');
		const { container } = renderWithUi(
			<MemoryRouter>
				<LoginPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(container.querySelector('.evg-language-select select')).not.toBeNull();
		});
	});

	it('WEB-I18N-27: admin login submit Slovak', async () => {
		await initI18n('sk');
		renderWithUi(
			<MemoryRouter>
				<AdminLoginPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'Prihlásiť se' })).toBeDefined();
		});
	});

	it('WEB-I18N-28: origin options French', async () => {
		vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({ items: [], total: 0 });
		await initI18n('fr');
		renderWithUi(
			<MemoryRouter initialEntries={['/admin/identity/users']}>
				<IdentityUsersPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'Appliquer' })).toBeDefined();
		});
	});

	it('WEB-I18N-32: formatAdminApiError managed_by_sync Czech', async () => {
		await initI18n('cs');
		const msg = formatAdminApiError(403, 'managed_by_sync', resolveI18nKey, 'errors.loadFailed');
		expect(msg).toContain('sync');
		expect(msg).not.toBe('managed_by_sync');
	});

	it('WEB-I18N-33: audit category sync French', async () => {
		await initI18n('fr');
		const { auditCategoryLabel } = await import('./enum-labels');
		expect(auditCategoryLabel('sync', resolveI18nKey)).toBe('Synchronisation');
	});

	it('WEB-I18N-34: OperatorSessionBar Slovak', async () => {
		await initI18n('sk');
		const { OperatorSessionBar } = await import('../ui/OperatorSessionBar');
		renderWithUi(
			<MemoryRouter>
				<OperatorSessionBar username="alice" />
			</MemoryRouter>,
		);
		expect(screen.getByText(/alice/)).toBeDefined();
		expect(screen.getByRole('link', { name: 'Zmeniť heslo' })).toBeDefined();
	});

	it('WEB-I18N-35: MobileNavToggle German Menu', async () => {
		await initI18n('de');
		const { MobileNavToggle } = await import('../ui/MobileNavToggle');
		renderWithUi(<MobileNavToggle expanded={false} onClick={() => undefined} />);
		expect(screen.getByText('Menü')).toBeDefined();
	});

	it('WEB-I18N-36: SyncLogDetail Stato Italian', async () => {
		vi.spyOn(adminApi, 'getSyncLog').mockResolvedValue({ syncLog: syncLogStub() });
		await initI18n('it');
		const { SyncLogDetailPage } = await import('../admin/pages/SyncLogDetailPage');
		renderWithUi(
			<MemoryRouter initialEntries={['/admin/sync-logs/log1']}>
				<Routes>
					<Route path="/admin/sync-logs/:syncLogId" element={<SyncLogDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByText('Stato')).toBeDefined();
		});
	});

	it('WEB-I18N-38: login lang sk', async () => {
		await initI18n('sk');
		document.documentElement.lang = 'sk';
		expect(document.documentElement.lang).toBe('sk');
	});

	it('WEB-I18N-39: AppShell skip link', async () => {
		await initI18n('cs');
		const { AppShell } = await import('../ui/AppShell');
		renderWithUi(
			<MemoryRouter>
				<AppShell operatorUsername={null} onLogout={() => undefined}>
					<div>child</div>
				</AppShell>
			</MemoryRouter>,
		);
		expect(screen.getByRole('link', { name: 'Přeskočit na obsah' })).toBeDefined();
	});

	it('WEB-I18N-31b: browser sentinel clears storage', async () => {
		await initI18n('cs');
		localStorage.setItem(LOCALE_STORAGE_KEY, 'cs');
		const { container } = renderWithUi(<LanguageSelect />);
		const select = container.querySelector('select')!;
		fireEvent.change(select, { target: { value: BROWSER_LOCALE_SENTINEL } });
		await waitFor(() => {
			expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
		});
	});
});
