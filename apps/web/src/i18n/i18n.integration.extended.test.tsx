import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '../admin/adminApi';
import * as authApi from '../auth/authApi';
import { AdminLoginPage } from '../admin/AdminLoginPage';
import { AuditLogPage } from '../admin/pages/AuditLogPage';
import { ApiConnectionsListPage } from '../admin/pages/ApiConnectionsListPage';
import { IdentityGroupsPage } from '../admin/pages/IdentityGroupsPage';
import { IdentityRolesPage } from '../admin/pages/IdentityRolesPage';
import { SpConnectionsListPage } from '../admin/pages/SpConnectionsListPage';
import { SidebarNav } from '../ui/SidebarNav';
import { LanguageSelect } from '../ui/LanguageSelect';
import { changeLocale, initI18n } from './i18n';
import { renderWithUi } from '../test/renderWithUi';
import { useAdminDocumentTitle } from './useAdminDocumentTitle';

function TitleProbe({ title }: { title: string }) {
	useAdminDocumentTitle(title);
	return null;
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	localStorage.clear();
});

describe('i18n integration — extended (WEB-I18N-99–115)', () => {
	it('WEB-I18N-99: SidebarNav German SP-Verbindungen', async () => {
		await initI18n('de');
		renderWithUi(
			<MemoryRouter>
				<SidebarNav operatorUsername="op" onLogout={() => undefined} />
			</MemoryRouter>,
		);
		expect(screen.getByRole('link', { name: 'SP-Verbindungen' })).toBeDefined();
	});

	it('WEB-I18N-100: LanguageSelect exposes eleven options', async () => {
		await initI18n('en');
		const { container } = renderWithUi(<LanguageSelect />);
		const options = container.querySelectorAll('option');
		expect(options.length).toBe(11);
	});

	it('WEB-I18N-101: changeLocale es updates common.save label', async () => {
		await initI18n('en');
		await changeLocale('es');
		const { resolveI18nKey } = await import('./api-error-messages');
		expect(resolveI18nKey('common.save')).toBe('Guardar');
	});

	it('WEB-I18N-102: IdentityGroups Polish heading', async () => {
		vi.spyOn(adminApi, 'listIdentityGroups').mockResolvedValue({ items: [], total: 0 });
		await initI18n('pl');
		renderWithUi(
			<MemoryRouter>
				<IdentityGroupsPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Grupy' })).toBeDefined();
		});
	});

	it('WEB-I18N-103: IdentityRoles Dutch heading', async () => {
		vi.spyOn(adminApi, 'listIdentityRoles').mockResolvedValue({ items: [], total: 0 });
		await initI18n('nl');
		renderWithUi(
			<MemoryRouter>
				<IdentityRolesPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Rollen' })).toBeDefined();
		});
	});

	it('WEB-I18N-104: AuditLogPage French filter button', async () => {
		vi.spyOn(adminApi, 'listAuditEvents').mockResolvedValue({
			items: [],
			total: 0,
			limit: 50,
			offset: 0,
		});
		await initI18n('fr');
		renderWithUi(
			<MemoryRouter>
				<AuditLogPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'Filtrer' })).toBeDefined();
		});
	});

	it('WEB-I18N-105: ApiConnectionsListPage Italian list heading', async () => {
		vi.spyOn(adminApi, 'listApiConnections').mockResolvedValue({ connections: [] });
		await initI18n('it');
		renderWithUi(
			<MemoryRouter>
				<ApiConnectionsListPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Connessioni API' })).toBeDefined();
		});
	});

	it('WEB-I18N-106: SpConnectionsListPage Portuguese heading', async () => {
		vi.spyOn(adminApi, 'listSpConnections').mockResolvedValue({ items: [] });
		await initI18n('pt');
		renderWithUi(
			<MemoryRouter>
				<SpConnectionsListPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: /Ligações SP|Conexões SP/i })).toBeDefined();
		});
	});

	it('WEB-I18N-107: useAdminDocumentTitle sets German document.title', async () => {
		await initI18n('de');
		const { resolveI18nKey } = await import('./api-error-messages');
		renderWithUi(
			<MemoryRouter>
				<TitleProbe title={resolveI18nKey('dashboard.title')} />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(document.title).toContain('Dashboard');
			expect(document.title).toContain('NestIdP');
		});
	});

	it('WEB-I18N-108: AdminLoginPage French sign-in button', async () => {
		await initI18n('fr');
		renderWithUi(
			<MemoryRouter>
				<AdminLoginPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'Se connecter' })).toBeDefined();
		});
	});

	it('WEB-I18N-116: AdminLoginPage Slovak remember labels', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockRejectedValue(
			new adminApi.AdminApiError(401, 'Unauthorized'),
		);
		await initI18n('sk');
		renderWithUi(
			<MemoryRouter>
				<AdminLoginPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole('checkbox', { name: /Zapamätať prihlásenie/i })).toBeDefined();
			expect(screen.getByRole('checkbox', { name: /Zostať prihlásený/i })).toBeDefined();
		});
	});

	it('WEB-I18N-109: login LanguageSelect change to cs', async () => {
		vi.spyOn(authApi, 'getEndUserSession').mockResolvedValue({
			authenticated: false,
			user: null,
			samlSession: null,
		});
		await initI18n('en');
		const { LoginPage } = await import('../login/LoginPage');
		const { container } = renderWithUi(
			<MemoryRouter>
				<LoginPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(container.querySelector('.evg-language-select select')).not.toBeNull();
		});
		const select = container.querySelector('.evg-language-select select')!;
		fireEvent.change(select, { target: { value: 'cs' } });
		await waitFor(() => {
			expect(document.documentElement.lang).toBe('cs');
		});
	});

	it('WEB-I18N-110: formatDateTime after locale switch', async () => {
		const { formatDateTime } = await import('./i18n');
		await initI18n('cs');
		const cs = formatDateTime('2026-01-15T10:00:00.000Z', 'cs');
		await changeLocale('sk');
		const sk = formatDateTime('2026-01-15T10:00:00.000Z', 'sk');
		expect(cs).toBeTruthy();
		expect(sk).toBeTruthy();
	});

	it('WEB-I18N-111: identity list filter aria-label Czech', async () => {
		vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({ items: [], total: 0 });
		const { IdentityUsersPage } = await import('../admin/pages/IdentityUsersPage');
		await initI18n('cs');
		renderWithUi(
			<MemoryRouter>
				<IdentityUsersPage />
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByLabelText(/Filtrovat uživatele/i)).toBeDefined();
		});
	});

	it('WEB-I18N-112: AppShell logout label Spanish', async () => {
		await initI18n('es');
		const { AppShell } = await import('../ui/AppShell');
		renderWithUi(
			<MemoryRouter>
				<AppShell operatorUsername="bob" onLogout={() => undefined}>
					<div />
				</AppShell>
			</MemoryRouter>,
		);
		expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeDefined();
	});

	it('WEB-I18N-113: sequential changeLocale through nine non-en locales', async () => {
		await initI18n('en');
		const codes = ['cs', 'sk', 'de', 'fr', 'es', 'pl', 'it', 'pt', 'nl'] as const;
		const { getI18n } = await import('./i18n');
		for (const code of codes) {
			await changeLocale(code);
			expect(getI18n().language).toBe(code);
			expect(document.documentElement.lang).toBe(code);
		}
	});

	it('WEB-I18N-114: e2e i18n-login-cs spec file exists', () => {
		expect(existsSync(join(import.meta.dirname, '../../e2e/i18n-login-cs.spec.ts'))).toBe(true);
	});

	it('WEB-I18N-115: I18nProvider exports initI18nForTests for vitest', async () => {
		const mod = await import('./I18nProvider');
		expect(typeof mod.initI18nForTests).toBe('function');
		await mod.initI18nForTests('en');
		const { resolveI18nKey } = await import('./api-error-messages');
		expect(resolveI18nKey('common.apply')).toBe('Apply');
	});
});
