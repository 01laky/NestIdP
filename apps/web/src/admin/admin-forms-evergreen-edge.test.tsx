import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
	ADMIN_USERS_ROUTE_PREFIX,
	API_CONNECTION_ROUTE_PREFIX,
	AUDIT_ROUTE_PREFIX,
	IDENTITY_ROUTE_PREFIX,
	IDP_SETTINGS_ROUTE_PREFIX,
	SP_CONNECTION_ROUTE_PREFIX,
} from '@nestidp/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from './adminApi';
import { renderWithUi } from '../test/renderWithUi';
import { ApiConnectionFormPage } from './pages/ApiConnectionFormPage';
import { ApiConnectionSyncPage } from './pages/ApiConnectionSyncPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { IdentityGroupsPage } from './pages/IdentityGroupsPage';
import { IdentityRolesPage } from './pages/IdentityRolesPage';
import { IdentityUserDetailPage } from './pages/IdentityUserDetailPage';
import { IdentityUsersPage } from './pages/IdentityUsersPage';
import { IdpSettingsPage } from './pages/IdpSettingsPage';
import { SpConnectionFormPage } from './pages/SpConnectionFormPage';
import { SpConnectionTestSsoPage } from './pages/SpConnectionTestSsoPage';
import { SyncLogDetailPage } from './pages/SyncLogDetailPage';

const webSrc = join(dirname(fileURLToPath(import.meta.url)), '..');

function apiConnectionStub() {
	return {
		id: 'c1',
		name: 'HR',
		baseUrl: 'https://api.example.com',
		authType: 'BEARER' as const,
		hasBearerToken: true,
		lastSyncAt: null,
		lastSyncStatus: 'NEVER' as const,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	};
}

function idpSettingsStub(overrides: Record<string, unknown> = {}) {
	return {
		entityId: 'http://localhost:3000',
		nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
		hasSigningCertificate: true,
		signingCertFingerprintSha256: 'aa:bb:cc',
		signingCertNotAfter: '2030-01-01T00:00:00.000Z',
		metadataUrl: 'http://localhost:3000/saml/metadata',
		ssoUrl: 'http://localhost:3000/saml/sso',
		idpBaseUrl: 'http://localhost:3000',
		rotation: {
			active: false,
			startedAt: null,
			hasPendingCertificate: false,
			pendingCertFingerprintSha256: null,
		},
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

beforeEach(() => {
	vi.spyOn(window, 'open').mockImplementation(() => null);
});

describe('Admin forms Evergreen — extended edge cases', () => {
	describe('ApiConnectionFormPage', () => {
		it('WEB-EVG-119: new form uses Panel title Connection details', () => {
			renderWithUi(
				<MemoryRouter initialEntries={[`${API_CONNECTION_ROUTE_PREFIX}/new`]}>
					<Routes>
						<Route
							path={`${API_CONNECTION_ROUTE_PREFIX}/new`}
							element={<ApiConnectionFormPage />}
						/>
					</Routes>
				</MemoryRouter>,
			);
			expect(screen.getByText('Connection details')).toBeDefined();
		});

		it('WEB-EVG-120: edit mode bearer label mentions leave blank to keep', async () => {
			vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue({
				connection: apiConnectionStub(),
			});
			renderWithUi(
				<MemoryRouter initialEntries={[`${API_CONNECTION_ROUTE_PREFIX}/c1`]}>
					<Routes>
						<Route
							path={`${API_CONNECTION_ROUTE_PREFIX}/:id`}
							element={<ApiConnectionFormPage />}
						/>
					</Routes>
				</MemoryRouter>,
			);
			await waitFor(() => {
				expect(screen.getByLabelText(/leave blank to keep/i)).toBeDefined();
			});
		});

		it('WEB-EVG-121: edit mode exposes Test connectivity secondary button', async () => {
			vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue({
				connection: apiConnectionStub(),
			});
			renderWithUi(
				<MemoryRouter initialEntries={[`${API_CONNECTION_ROUTE_PREFIX}/c1`]}>
					<Routes>
						<Route
							path={`${API_CONNECTION_ROUTE_PREFIX}/:id`}
							element={<ApiConnectionFormPage />}
						/>
					</Routes>
				</MemoryRouter>,
			);
			await waitFor(() => {
				const btn = screen.getByRole('button', { name: /Test connectivity/i });
				expect(btn.className).toContain('evg-btn--secondary');
			});
		});

		it('WEB-EVG-122: edit mode Delete uses danger variant', async () => {
			vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue({
				connection: apiConnectionStub(),
			});
			renderWithUi(
				<MemoryRouter initialEntries={[`${API_CONNECTION_ROUTE_PREFIX}/c1`]}>
					<Routes>
						<Route
							path={`${API_CONNECTION_ROUTE_PREFIX}/:id`}
							element={<ApiConnectionFormPage />}
						/>
					</Routes>
				</MemoryRouter>,
			);
			await waitFor(() => {
				expect(screen.getByRole('button', { name: 'Delete' }).className).toContain(
					'evg-btn--danger',
				);
			});
		});

		it('WEB-EVG-123: back link uses evg-btn--link', () => {
			const { container } = renderWithUi(
				<MemoryRouter initialEntries={[`${API_CONNECTION_ROUTE_PREFIX}/new`]}>
					<Routes>
						<Route
							path={`${API_CONNECTION_ROUTE_PREFIX}/new`}
							element={<ApiConnectionFormPage />}
						/>
					</Routes>
				</MemoryRouter>,
			);
			const link = container.querySelector('a.evg-btn--link');
			expect(link?.textContent).toContain('Back to list');
		});

		it('WEB-EVG-124: load failure shows ErrorBanner', async () => {
			vi.spyOn(adminApi, 'getApiConnection').mockRejectedValue(
				new adminApi.AdminApiError(500, 'Server error'),
			);
			renderWithUi(
				<MemoryRouter initialEntries={[`${API_CONNECTION_ROUTE_PREFIX}/c1`]}>
					<Routes>
						<Route
							path={`${API_CONNECTION_ROUTE_PREFIX}/:id`}
							element={<ApiConnectionFormPage />}
						/>
					</Routes>
				</MemoryRouter>,
			);
			await waitFor(() => {
				expect(screen.getByRole('alert').textContent).toContain('Server error');
			});
		});

		it('WEB-EVG-163: test connectivity displays API message', async () => {
			vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue({
				connection: apiConnectionStub(),
			});
			vi.spyOn(adminApi, 'testApiConnection').mockResolvedValue({
				ok: true,
				reachable: true,
				message: 'OK: 200',
			});
			renderWithUi(
				<MemoryRouter initialEntries={[`${API_CONNECTION_ROUTE_PREFIX}/c1`]}>
					<Routes>
						<Route
							path={`${API_CONNECTION_ROUTE_PREFIX}/:id`}
							element={<ApiConnectionFormPage />}
						/>
					</Routes>
				</MemoryRouter>,
			);
			await waitFor(() => screen.getByRole('button', { name: /Test connectivity/i }));
			fireEvent.click(screen.getByRole('button', { name: /Test connectivity/i }));
			await waitFor(() => {
				expect(screen.getByText(/OK: 200/)).toBeDefined();
			});
		});

		it('WEB-EVG-164: form sets aria-busy while saving', async () => {
			let resolveCreate!: (v: Awaited<ReturnType<typeof adminApi.createApiConnection>>) => void;
			vi.spyOn(adminApi, 'createApiConnection').mockImplementation(
				() =>
					new Promise((resolve) => {
						resolveCreate = resolve;
					}),
			);
			const { container } = renderWithUi(
				<MemoryRouter initialEntries={[`${API_CONNECTION_ROUTE_PREFIX}/new`]}>
					<Routes>
						<Route
							path={`${API_CONNECTION_ROUTE_PREFIX}/new`}
							element={<ApiConnectionFormPage />}
						/>
					</Routes>
				</MemoryRouter>,
			);
			expect(container.querySelector('form[aria-busy="true"]')).toBeNull();
			fireEvent.change(container.querySelector('input[name="name"]')!, {
				target: { value: 'HR' },
			});
			fireEvent.change(container.querySelector('input[name="baseUrl"]')!, {
				target: { value: 'https://api.example.com' },
			});
			fireEvent.change(container.querySelector('input[name="bearerToken"]')!, {
				target: { value: 'secret' },
			});
			fireEvent.click(screen.getByRole('button', { name: 'Save' }));
			await waitFor(() => {
				expect(container.querySelector('form[aria-busy="true"]')).not.toBeNull();
			});
			resolveCreate({ connection: apiConnectionStub() });
		});
	});

	describe('ApiConnectionSyncPage', () => {
		async function renderSync() {
			vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue({
				connection: apiConnectionStub(),
			});
			vi.spyOn(adminApi, 'getSyncStatus').mockResolvedValue({
				connectionId: 'c1',
				lastSyncAt: null,
				lastSyncStatus: 'NEVER',
				syncInProgress: false,
				latestSyncLog: null,
			});
			vi.spyOn(adminApi, 'listSyncLogs').mockResolvedValue({ syncLogs: [] });
			renderWithUi(
				<MemoryRouter initialEntries={[`${API_CONNECTION_ROUTE_PREFIX}/c1/sync`]}>
					<Routes>
						<Route
							path={`${API_CONNECTION_ROUTE_PREFIX}/:id/sync`}
							element={<ApiConnectionSyncPage />}
						/>
					</Routes>
				</MemoryRouter>,
			);
			await waitFor(() => screen.getByText('Run sync'));
		}

		it('WEB-EVG-125: dry-run checkbox toggles label on submit button', async () => {
			await renderSync();
			const checkbox = screen.getByRole('checkbox', { name: /Dry run/i });
			expect(screen.getByRole('button', { name: /Run full sync/i })).toBeDefined();
			fireEvent.click(checkbox);
			expect(screen.getByRole('button', { name: /Run dry sync/i })).toBeDefined();
		});

		it('WEB-EVG-127: sync page shows current status from API', async () => {
			await renderSync();
			expect(screen.getByText(/Current status: NEVER/i)).toBeDefined();
		});

		it('WEB-EVG-128: dry-run checkbox label mentions no DB writes', async () => {
			await renderSync();
			expect(screen.getByRole('checkbox', { name: /Dry run \(no DB writes\)/i })).toBeDefined();
		});

		it('WEB-EVG-126: sync button shows Running while syncing', async () => {
			let resolveSync!: (v: Awaited<ReturnType<typeof adminApi.triggerIdentitySync>>) => void;
			await renderSync();
			vi.spyOn(adminApi, 'triggerIdentitySync').mockImplementation(
				() =>
					new Promise((resolve) => {
						resolveSync = resolve;
					}),
			);
			fireEvent.click(screen.getByRole('button', { name: /Run full sync/i }));
			const { clickDialogConfirm } = await import('../test/confirm-dialog-helpers');
			await screen.findByRole('dialog');
			clickDialogConfirm('Run full sync');
			await waitFor(() => {
				expect(screen.getByRole('button', { name: /Running/i })).toBeDefined();
			});
			resolveSync({
				syncLog: {
					id: 'log1',
					apiConnectionId: 'c1',
					startedAt: '2026-01-01T00:00:00.000Z',
					finishedAt: null,
					durationMs: null,
					status: 'RUNNING',
					usersSynced: 0,
					groupsSynced: 0,
					rolesSynced: 0,
					dryRun: true,
					errors: null,
				},
				connection: apiConnectionStub(),
			});
		});
	});

	describe('SpConnectionFormPage', () => {
		it('WEB-EVG-129: new SP form uses Panel title SP connection', () => {
			renderWithUi(
				<MemoryRouter initialEntries={[`${SP_CONNECTION_ROUTE_PREFIX}/new`]}>
					<Routes>
						<Route path={`${SP_CONNECTION_ROUTE_PREFIX}/new`} element={<SpConnectionFormPage />} />
					</Routes>
				</MemoryRouter>,
			);
			expect(screen.getByText('SP connection')).toBeDefined();
		});

		it('WEB-EVG-130: NameID format select is present on new form', () => {
			renderWithUi(
				<MemoryRouter initialEntries={[`${SP_CONNECTION_ROUTE_PREFIX}/new`]}>
					<Routes>
						<Route path={`${SP_CONNECTION_ROUTE_PREFIX}/new`} element={<SpConnectionFormPage />} />
					</Routes>
				</MemoryRouter>,
			);
			expect(screen.getByLabelText(/^NameID format/)).toBeDefined();
		});

		it('WEB-EVG-131: optional SP cert TextArea has paste hint', () => {
			renderWithUi(
				<MemoryRouter initialEntries={[`${SP_CONNECTION_ROUTE_PREFIX}/new`]}>
					<Routes>
						<Route path={`${SP_CONNECTION_ROUTE_PREFIX}/new`} element={<SpConnectionFormPage />} />
					</Routes>
				</MemoryRouter>,
			);
			expect(screen.getByText(/Paste PEM certificate/i)).toBeDefined();
		});

		it('WEB-EVG-132: edit SP form includes attribute mapping Fieldset', async () => {
			vi.spyOn(adminApi, 'getSpConnection').mockResolvedValue({
				id: 'sp1',
				name: 'App',
				spEntityId: 'urn:sp:1',
				acsUrl: 'https://sp.example.com/acs',
				nameIdFormat: '',
				attributeMapping: null,
				active: true,
				hasSpCertificate: false,
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			});
			renderWithUi(
				<MemoryRouter initialEntries={[`${SP_CONNECTION_ROUTE_PREFIX}/sp1`]}>
					<Routes>
						<Route path={`${SP_CONNECTION_ROUTE_PREFIX}/:id`} element={<SpConnectionFormPage />} />
					</Routes>
				</MemoryRouter>,
			);
			await waitFor(() => {
				expect(screen.getByText('Attribute mapping')).toBeDefined();
			});
		});

		it('WEB-EVG-165: Active checkbox reflects loaded inactive state', async () => {
			vi.spyOn(adminApi, 'getSpConnection').mockResolvedValue({
				id: 'sp1',
				name: 'App',
				spEntityId: 'urn:sp:1',
				acsUrl: 'https://sp.example.com/acs',
				nameIdFormat: '',
				attributeMapping: null,
				active: false,
				hasSpCertificate: false,
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			});
			renderWithUi(
				<MemoryRouter initialEntries={[`${SP_CONNECTION_ROUTE_PREFIX}/sp1`]}>
					<Routes>
						<Route path={`${SP_CONNECTION_ROUTE_PREFIX}/:id`} element={<SpConnectionFormPage />} />
					</Routes>
				</MemoryRouter>,
			);
			await waitFor(() => {
				const box = screen.getByRole('checkbox', { name: 'Active' }) as HTMLInputElement;
				expect(box.checked).toBe(false);
			});
		});
	});

	describe('IdpSettingsPage', () => {
		function renderIdp(overrides: Record<string, unknown> = {}) {
			vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue(
				idpSettingsStub(overrides) as Awaited<ReturnType<typeof adminApi.getIdpSettings>>,
			);
			return renderWithUi(
				<MemoryRouter initialEntries={[IDP_SETTINGS_ROUTE_PREFIX]}>
					<Routes>
						<Route path={IDP_SETTINGS_ROUTE_PREFIX} element={<IdpSettingsPage />} />
					</Routes>
				</MemoryRouter>,
			);
		}

		it('WEB-EVG-140: Overview Copy buttons use link variant', async () => {
			renderIdp();
			await waitFor(() => {
				expect(screen.getAllByRole('button', { name: 'Copy' }).length).toBeGreaterThanOrEqual(2);
			});
			const copies = screen.getAllByRole('button', { name: 'Copy' });
			for (const btn of copies) {
				expect(btn.className).toContain('evg-btn--link');
			}
		});

		it('WEB-EVG-141: entity ID mismatch shows ErrorBanner', async () => {
			renderIdp({ entityId: 'https://other.example.com', idpBaseUrl: 'http://localhost:3000' });
			await waitFor(() => {
				expect(screen.getByRole('alert').textContent).toContain('differs from IDP_BASE_URL');
			});
		});

		it('WEB-EVG-142: expiring certificate shows warning callout', async () => {
			const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
			renderIdp({ signingCertNotAfter: soon });
			await waitFor(() => {
				expect(screen.getByText(/Signing certificate expires on/i)).toBeDefined();
			});
		});

		it('WEB-EVG-143: upload Cancel hides upload panel', async () => {
			renderIdp();
			await waitFor(() => screen.getByRole('button', { name: 'Upload certificate' }));
			fireEvent.click(screen.getByRole('button', { name: 'Upload certificate' }));
			expect(screen.getByLabelText(/Signing certificate PEM/)).toBeDefined();
			fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
			expect(screen.queryByLabelText(/Signing certificate PEM/)).toBeNull();
		});

		it('WEB-EVG-144: metadata refresh renders CodeBlock with XML', async () => {
			vi.spyOn(adminApi, 'getIdpMetadataPreview').mockResolvedValue({
				xml: '<EntityDescriptor entityID="test" />',
				contentType: 'application/xml',
			});
			renderIdp();
			await waitFor(() => screen.getByRole('button', { name: 'Refresh preview' }));
			fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
			await waitFor(() => {
				expect(screen.getByText(/EntityDescriptor/)).toBeDefined();
			});
		});

		it('WEB-EVG-145: rotation active shows Complete rotation primary button', async () => {
			renderIdp({
				rotation: {
					active: true,
					startedAt: '2026-01-01T00:00:00.000Z',
					hasPendingCertificate: true,
					pendingCertFingerprintSha256: 'cc:dd',
				},
			});
			await waitFor(() => {
				expect(screen.getByRole('button', { name: 'Complete rotation' }).className).toContain(
					'evg-btn--primary',
				);
			});
		});

		it('WEB-EVG-146: Generate certificate disabled while rotation active', async () => {
			renderIdp({
				rotation: {
					active: true,
					startedAt: '2026-01-01T00:00:00.000Z',
					hasPendingCertificate: true,
					pendingCertFingerprintSha256: 'cc:dd',
				},
			});
			await waitFor(() => {
				expect(screen.getByRole('button', { name: 'Generate certificate' })).toHaveProperty(
					'disabled',
					true,
				);
			});
		});
	});

	describe('AdminUsersPage', () => {
		async function renderAdmins(admins: Awaited<ReturnType<typeof adminApi.listAdminUsers>>) {
			vi.spyOn(adminApi, 'listAdminUsers').mockResolvedValue(admins);
			vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
				admin: { id: 'a1', username: 'admin' },
				csrfToken: 't',
			});
			renderWithUi(
				<MemoryRouter initialEntries={[ADMIN_USERS_ROUTE_PREFIX]}>
					<Routes>
						<Route path={ADMIN_USERS_ROUTE_PREFIX} element={<AdminUsersPage />} />
					</Routes>
				</MemoryRouter>,
			);
			await waitFor(() => screen.getByRole('button', { name: 'Create admin' }));
		}

		it('WEB-EVG-147: create panel uses Panel section title', async () => {
			await renderAdmins([]);
			expect(screen.getByRole('heading', { name: 'Create admin' })).toBeDefined();
			expect(screen.getByText('Change my password')).toBeDefined();
		});

		it('WEB-EVG-148: change-password panel preserves id anchor', async () => {
			const { container } = renderWithUi(
				<MemoryRouter initialEntries={[ADMIN_USERS_ROUTE_PREFIX]}>
					<Routes>
						<Route path={ADMIN_USERS_ROUTE_PREFIX} element={<AdminUsersPage />} />
					</Routes>
				</MemoryRouter>,
			);
			vi.spyOn(adminApi, 'listAdminUsers').mockResolvedValue([]);
			vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
				admin: { id: 'a1', username: 'admin' },
				csrfToken: 't',
			});
			await waitFor(() => container.querySelector('#change-password'));
			expect(container.querySelector('#change-password')).not.toBeNull();
		});

		it('WEB-EVG-149: sole admin row shows em dash instead of Delete', async () => {
			await renderAdmins([
				{
					id: 'a1',
					username: 'admin',
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
			]);
			const row = screen.getByRole('row', { name: /admin/i });
			expect(within(row).getByText('—')).toBeDefined();
			expect(within(row).queryByRole('button', { name: 'Delete' })).toBeNull();
		});
	});

	describe('AuditLogPage', () => {
		it('WEB-EVG-150: export actions use link Button variant', async () => {
			vi.spyOn(adminApi, 'listAuditEvents').mockResolvedValue({
				items: [],
				total: 0,
				limit: 50,
				offset: 0,
			});
			renderWithUi(
				<MemoryRouter initialEntries={[AUDIT_ROUTE_PREFIX]}>
					<Routes>
						<Route path={AUDIT_ROUTE_PREFIX} element={<AuditLogPage />} />
					</Routes>
				</MemoryRouter>,
			);
			await waitFor(() => screen.getByRole('button', { name: 'Export CSV' }));
			expect(screen.getByRole('button', { name: 'Export CSV' }).className).toContain(
				'evg-btn--link',
			);
			expect(screen.getByRole('button', { name: 'Export JSON' }).className).toContain(
				'evg-btn--link',
			);
		});

		it('WEB-EVG-151: filters live inside collapsible details', async () => {
			vi.spyOn(adminApi, 'listAuditEvents').mockResolvedValue({
				items: [],
				total: 0,
				limit: 50,
				offset: 0,
			});
			const { container } = renderWithUi(
				<MemoryRouter initialEntries={[AUDIT_ROUTE_PREFIX]}>
					<Routes>
						<Route path={AUDIT_ROUTE_PREFIX} element={<AuditLogPage />} />
					</Routes>
				</MemoryRouter>,
			);
			await waitFor(() => container.querySelector('details.evg-filters-panel'));
			expect(container.querySelector('summary')?.textContent).toContain('Filters');
		});
	});

	describe('IdentityUsersPage', () => {
		it('WEB-EVG-152: search row uses evg-inline-form', () => {
			vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({ items: [], total: 0 });
			const { container } = renderWithUi(
				<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/users`]}>
					<Routes>
						<Route path={`${IDENTITY_ROUTE_PREFIX}/users`} element={<IdentityUsersPage />} />
					</Routes>
				</MemoryRouter>,
			);
			expect(container.querySelector('form.evg-inline-form')).not.toBeNull();
		});

		it('WEB-EVG-153: users list Apply submit is secondary Button', () => {
			vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({ items: [], total: 0 });
			renderWithUi(
				<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/users`]}>
					<Routes>
						<Route path={`${IDENTITY_ROUTE_PREFIX}/users`} element={<IdentityUsersPage />} />
					</Routes>
				</MemoryRouter>,
			);
			expect(screen.getByRole('button', { name: 'Apply' }).className).toContain(
				'evg-btn--secondary',
			);
		});

		it('WEB-EVG-153b: groups list Apply submit is secondary Button', () => {
			vi.spyOn(adminApi, 'listIdentityGroups').mockResolvedValue({ items: [], total: 0 });
			renderWithUi(
				<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/groups`]}>
					<Routes>
						<Route path={`${IDENTITY_ROUTE_PREFIX}/groups`} element={<IdentityGroupsPage />} />
					</Routes>
				</MemoryRouter>,
			);
			expect(screen.getByRole('button', { name: 'Apply' }).className).toContain(
				'evg-btn--secondary',
			);
		});

		it('WEB-EVG-153c: roles list Apply submit is secondary Button', () => {
			vi.spyOn(adminApi, 'listIdentityRoles').mockResolvedValue({ items: [], total: 0 });
			renderWithUi(
				<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/roles`]}>
					<Routes>
						<Route path={`${IDENTITY_ROUTE_PREFIX}/roles`} element={<IdentityRolesPage />} />
					</Routes>
				</MemoryRouter>,
			);
			expect(screen.getByRole('button', { name: 'Apply' }).className).toContain(
				'evg-btn--secondary',
			);
		});
	});

	describe('SyncLogDetailPage', () => {
		it('WEB-EVG-154: SUCCESS status renders success Badge', async () => {
			vi.spyOn(adminApi, 'getSyncLog').mockResolvedValue({
				syncLog: {
					id: 'log1',
					apiConnectionId: 'c1',
					startedAt: '2026-01-01T00:00:00.000Z',
					finishedAt: '2026-01-01T00:01:00.000Z',
					durationMs: 60_000,
					status: 'SUCCESS',
					usersSynced: 1,
					groupsSynced: 0,
					rolesSynced: 0,
					dryRun: false,
					errors: null,
				},
			});
			renderWithUi(
				<MemoryRouter initialEntries={['/admin/sync-logs/log1']}>
					<Routes>
						<Route path="/admin/sync-logs/:syncLogId" element={<SyncLogDetailPage />} />
					</Routes>
				</MemoryRouter>,
			);
			await waitFor(() => {
				const badge = screen.getByText('SUCCESS');
				expect(badge.className).toContain('evg-badge--success');
			});
		});

		it('WEB-EVG-155: FAILED status renders danger Badge', async () => {
			vi.spyOn(adminApi, 'getSyncLog').mockResolvedValue({
				syncLog: {
					id: 'log1',
					apiConnectionId: 'c1',
					startedAt: '2026-01-01T00:00:00.000Z',
					finishedAt: '2026-01-01T00:01:00.000Z',
					durationMs: 60_000,
					status: 'FAILED',
					usersSynced: 0,
					groupsSynced: 0,
					rolesSynced: 0,
					dryRun: false,
					errors: [{ phase: 'user_limit', message: 'fail' }],
				},
			});
			renderWithUi(
				<MemoryRouter initialEntries={['/admin/sync-logs/log1']}>
					<Routes>
						<Route path="/admin/sync-logs/:syncLogId" element={<SyncLogDetailPage />} />
					</Routes>
				</MemoryRouter>,
			);
			await waitFor(() => {
				const badge = screen.getByText('FAILED');
				expect(badge.className).toContain('evg-badge--danger');
			});
		});

		it('WEB-EVG-156: no errors shows muted empty message', async () => {
			vi.spyOn(adminApi, 'getSyncLog').mockResolvedValue({
				syncLog: {
					id: 'log1',
					apiConnectionId: 'c1',
					startedAt: '2026-01-01T00:00:00.000Z',
					finishedAt: '2026-01-01T00:01:00.000Z',
					durationMs: 60_000,
					status: 'SUCCESS',
					usersSynced: 1,
					groupsSynced: 0,
					rolesSynced: 0,
					dryRun: false,
					errors: null,
				},
			});
			renderWithUi(
				<MemoryRouter initialEntries={['/admin/sync-logs/log1']}>
					<Routes>
						<Route path="/admin/sync-logs/:syncLogId" element={<SyncLogDetailPage />} />
					</Routes>
				</MemoryRouter>,
			);
			await waitFor(() => {
				expect(screen.getByText(/No errors recorded/i)).toBeDefined();
			});
		});
	});

	describe('SpConnectionTestSsoPage', () => {
		it('WEB-EVG-157: command TextArea is readOnly', async () => {
			vi.spyOn(adminApi, 'getSpConnection').mockResolvedValue({
				id: 'sp1',
				name: 'App',
				spEntityId: 'urn:sp:1',
				acsUrl: 'https://sp.example.com/acs',
				nameIdFormat: '',
				attributeMapping: null,
				active: true,
				hasSpCertificate: false,
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			});
			vi.spyOn(adminApi, 'getIdpMetadataUrl').mockResolvedValue({
				metadataUrl: 'http://localhost:3000/saml/metadata',
				entityId: 'http://localhost:3000',
				ssoUrl: 'http://localhost:3000/saml/sso',
			});
			renderWithUi(
				<MemoryRouter initialEntries={[`${SP_CONNECTION_ROUTE_PREFIX}/sp1/test-sso`]}>
					<Routes>
						<Route
							path={`${SP_CONNECTION_ROUTE_PREFIX}/:id/test-sso`}
							element={<SpConnectionTestSsoPage />}
						/>
					</Routes>
				</MemoryRouter>,
			);
			await waitFor(() => {
				const area = screen.getByLabelText(/Command/i) as HTMLTextAreaElement;
				expect(area.readOnly).toBe(true);
			});
		});

		it('WEB-EVG-158: command focus selects all text', async () => {
			const selectSpy = vi
				.spyOn(HTMLTextAreaElement.prototype, 'select')
				.mockImplementation(() => {});
			vi.spyOn(adminApi, 'getSpConnection').mockResolvedValue({
				id: 'sp1',
				name: 'App',
				spEntityId: 'urn:sp:1',
				acsUrl: 'https://sp.example.com/acs',
				nameIdFormat: '',
				attributeMapping: null,
				active: true,
				hasSpCertificate: false,
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			});
			vi.spyOn(adminApi, 'getIdpMetadataUrl').mockResolvedValue({
				metadataUrl: 'http://localhost:3000/saml/metadata',
				entityId: 'http://localhost:3000',
				ssoUrl: 'http://localhost:3000/saml/sso',
			});
			renderWithUi(
				<MemoryRouter initialEntries={[`${SP_CONNECTION_ROUTE_PREFIX}/sp1/test-sso`]}>
					<Routes>
						<Route
							path={`${SP_CONNECTION_ROUTE_PREFIX}/:id/test-sso`}
							element={<SpConnectionTestSsoPage />}
						/>
					</Routes>
				</MemoryRouter>,
			);
			await waitFor(() => screen.getByLabelText(/Command/i));
			fireEvent.focus(screen.getByLabelText(/Command/i));
			expect(selectSpy).toHaveBeenCalled();
			selectSpy.mockRestore();
		});
	});

	describe('IdentityUserDetailPage', () => {
		it('WEB-EVG-159: groups and roles use Panel sections', async () => {
			vi.spyOn(adminApi, 'getIdentityUser').mockResolvedValue({
				user: {
					id: 'u1',
					username: 'alice',
					email: 'a@example.com',
					displayName: 'Alice',
					externalId: 'ext-1',
					apiConnectionId: 'c1',
					origin: 'synced',
					active: true,
				},
				groups: [{ id: 'g1', name: 'Admins' }],
				roles: [{ id: 'r1', name: 'User' }],
				source: {
					kind: 'api_connection',
					label: 'HR',
					apiConnectionId: 'c1',
					apiConnectionRoute: '/admin/api-connections/c1',
				},
			});
			renderWithUi(
				<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/users/u1`]}>
					<Routes>
						<Route
							path={`${IDENTITY_ROUTE_PREFIX}/users/:id`}
							element={<IdentityUserDetailPage />}
						/>
					</Routes>
				</MemoryRouter>,
			);
			await waitFor(() => {
				expect(screen.getByText('Groups (1)')).toBeDefined();
				expect(screen.getByText('Roles (1)')).toBeDefined();
			});
		});
	});
});

describe('Admin forms static conventions — edge cases', () => {
	const formPages = [
		'ApiConnectionFormPage.tsx',
		'ApiConnectionSyncPage.tsx',
		'SpConnectionFormPage.tsx',
		'IdpSettingsPage.tsx',
		'AdminUsersPage.tsx',
		'AuditLogPage.tsx',
		'IdentityUsersPage.tsx',
	];

	function walkTsx(dir: string, out: string[] = []): string[] {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) {
				if (name === 'node_modules' || name === 'test') {
					continue;
				}
				walkTsx(path, out);
			} else if (
				/\.tsx$/.test(name) &&
				!name.endsWith('.test.tsx') &&
				!name.includes('.evergreen')
			) {
				out.push(path);
			}
		}
		return out;
	}

	it('WEB-EVG-160: migrated form pages import Evergreen controls from ui barrel', () => {
		const expectations: Record<string, string[]> = {
			'ApiConnectionFormPage.tsx': ['TextInput', 'Button'],
			'ApiConnectionSyncPage.tsx': ['Button', 'Checkbox'],
			'SpConnectionFormPage.tsx': ['TextInput', 'Button'],
			'IdpSettingsPage.tsx': ['TextInput', 'Button'],
			'AdminUsersPage.tsx': ['TextInput', 'Button'],
			'AuditLogPage.tsx': ['Button'],
			'IdentityUsersPage.tsx': ['TextInput', 'Button', 'ButtonLink'],
			'IdentityUserFormPage.tsx': ['TextInput', 'Button', 'ButtonLink', 'Panel'],
			'IdentityGroupFormPage.tsx': ['TextInput', 'Button', 'ButtonLink', 'Panel'],
			'IdentityRoleFormPage.tsx': ['TextInput', 'Button', 'ButtonLink', 'Panel'],
			'IdentityGroupDetailPage.tsx': ['Button', 'ButtonLink', 'Panel', 'Table'],
			'IdentityRoleDetailPage.tsx': ['Button', 'ButtonLink', 'Panel', 'Table'],
			'IdentityGroupsPage.tsx': ['Button', 'ButtonLink', 'Select'],
			'IdentityRolesPage.tsx': ['Button', 'ButtonLink', 'Select'],
			'IdentityUserDetailPage.tsx': ['Button', 'ButtonLink', 'Panel'],
		};
		const missing: string[] = [];
		for (const file of formPages) {
			const text = readFileSync(join(webSrc, 'admin/pages', file), 'utf8');
			if (!/from ['"]\.\.\/\.\.\/ui['"]/.test(text)) {
				missing.push(file);
			}
			for (const symbol of expectations[file] ?? []) {
				if (!text.includes(symbol)) {
					missing.push(`${file} (missing ${symbol})`);
				}
			}
		}
		expect(missing).toEqual([]);
	});

	it('WEB-EVG-161: admin pages do not hand-apply className evg-input on raw inputs', () => {
		const pagesDir = join(webSrc, 'admin/pages');
		const hits: string[] = [];
		for (const file of walkTsx(pagesDir)) {
			const text = readFileSync(file, 'utf8');
			if (/className="evg-input"/.test(text)) {
				hits.push(file);
			}
		}
		expect(hits).toEqual([]);
	});

	it('WEB-EVG-162: primary editor pages wrap content in evg-panel via Panel', () => {
		const missing: string[] = [];
		for (const file of [
			'ApiConnectionFormPage.tsx',
			'ApiConnectionSyncPage.tsx',
			'SpConnectionFormPage.tsx',
		]) {
			const text = readFileSync(join(webSrc, 'admin/pages', file), 'utf8');
			if (!text.includes('Panel')) {
				missing.push(file);
			}
		}
		expect(missing).toEqual([]);
	});

	it('WEB-EVG-166: admin components import Select/TextArea from ui barrel', () => {
		const text = readFileSync(join(webSrc, 'admin/components/AttributeMappingEditor.tsx'), 'utf8');
		expect(text).toContain("from '../../ui'");
		expect(text).toContain('Fieldset');
	});

	it('WEB-EVG-167: IdpSettingsPage uses CodeBlock for metadata not raw pre only', () => {
		const text = readFileSync(join(webSrc, 'admin/pages/IdpSettingsPage.tsx'), 'utf8');
		expect(text).toContain('CodeBlock');
		expect(text).not.toMatch(/<pre className="evg-code-block">/);
	});

	it('WEB-EVG-168: SyncLogDetailPage uses syncLogStatusToBadge helper', () => {
		const text = readFileSync(join(webSrc, 'admin/pages/SyncLogDetailPage.tsx'), 'utf8');
		expect(text).toContain('syncLogStatusToBadge');
		expect(text).toContain('Badge');
	});

	it('WEB-EVG-171: admin pages regression — no raw input/button (identity forms included)', () => {
		const pagesDir = join(webSrc, 'admin/pages');
		const forbidden = [/<input[\s>/]/, /<button[\s>/]/, /<select[\s>/]/, /<textarea[\s>/]/];
		const hits: string[] = [];
		for (const file of walkTsx(pagesDir)) {
			const text = readFileSync(file, 'utf8');
			for (const re of forbidden) {
				if (re.test(text)) {
					hits.push(file);
					break;
				}
			}
		}
		expect(hits).toEqual([]);
	});
});
