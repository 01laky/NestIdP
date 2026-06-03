import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
	ADMIN_USERS_ROUTE_PREFIX,
	API_CONNECTION_ROUTE_PREFIX,
	AUDIT_ROUTE_PREFIX,
	IDP_SETTINGS_ROUTE_PREFIX,
	SP_CONNECTION_ROUTE_PREFIX,
	type ApiConnectionDto,
	type AuditEventListResponseDto,
	type SyncLogDto,
	type SyncStatusResponseDto,
} from '@nestidp/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from './adminApi';
import { renderWithUi } from '../test/renderWithUi';
import { ApiConnectionFormPage } from './pages/ApiConnectionFormPage';
import { ApiConnectionSyncPage } from './pages/ApiConnectionSyncPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { IdpSettingsPage } from './pages/IdpSettingsPage';
import { SpConnectionFormPage } from './pages/SpConnectionFormPage';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
	const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
	return {
		...actual,
		useNavigate: () => navigateMock,
	};
});

beforeEach(() => {
	navigateMock.mockReset();
	vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function toastMessages(): string[] {
	return screen.getAllByRole('status').map((n) => n.textContent ?? '');
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

function syncLogStub(overrides: Partial<SyncLogDto> = {}): SyncLogDto {
	return {
		id: 'log1',
		apiConnectionId: 'c1',
		startedAt: '2026-01-01T00:00:00.000Z',
		finishedAt: '2026-01-01T00:01:00.000Z',
		durationMs: 60_000,
		status: 'SUCCESS',
		usersSynced: 1,
		groupsSynced: 0,
		rolesSynced: 0,
		dryRun: true,
		errors: null,
		...overrides,
	};
}

function syncStatusStub(overrides: Partial<SyncStatusResponseDto> = {}): SyncStatusResponseDto {
	return {
		connectionId: 'c1',
		lastSyncAt: null,
		lastSyncStatus: 'NEVER',
		syncInProgress: false,
		latestSyncLog: null,
		...overrides,
	};
}

describe('Evergreen toast integration — mutation flows', () => {
	it('WEB-EVG-41: ApiConnectionFormPage shows toast after create', async () => {
		vi.spyOn(adminApi, 'createApiConnection').mockResolvedValue({
			connection: apiConnectionStub(),
		});

		renderWithUi(
			<MemoryRouter initialEntries={[`${API_CONNECTION_ROUTE_PREFIX}/new`]}>
				<Routes>
					<Route path={`${API_CONNECTION_ROUTE_PREFIX}/new`} element={<ApiConnectionFormPage />} />
				</Routes>
			</MemoryRouter>,
		);

		fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'HR' } });
		fireEvent.change(screen.getByLabelText(/Base URL/i), {
			target: { value: 'https://api.example.com' },
		});
		fireEvent.change(screen.getByLabelText(/Bearer token/i), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('button', { name: /Save/i }));

		await waitFor(() => {
			expect(toastMessages().some((t) => t.includes('Connection saved'))).toBe(true);
		});
	});

	it('WEB-EVG-42: SpConnectionFormPage shows toast after create', async () => {
		vi.spyOn(adminApi, 'createSpConnection').mockResolvedValue({
			item: {
				id: 'sp-new',
				name: 'New App',
				spEntityId: 'urn:sp:new',
				acsUrl: 'https://sp.example.com/acs',
				nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
				attributeMapping: null,
				active: true,
				hasSpCertificate: false,
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
		});

		const { container } = renderWithUi(
			<MemoryRouter initialEntries={[`${SP_CONNECTION_ROUTE_PREFIX}/new`]}>
				<Routes>
					<Route path="/admin/sp-connections/new" element={<SpConnectionFormPage />} />
				</Routes>
			</MemoryRouter>,
		);

		const form = container.querySelector('form')!;
		fireEvent.change(form.querySelector('input[name="name"]')!, { target: { value: 'New App' } });
		fireEvent.change(form.querySelector('input[name="spEntityId"]')!, {
			target: { value: 'urn:sp:new' },
		});
		fireEvent.change(form.querySelector('input[name="acsUrl"]')!, {
			target: { value: 'https://sp.example.com/acs' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		await waitFor(() => {
			expect(toastMessages().some((t) => t.includes('SP connection saved'))).toBe(true);
		});
	});

	it('WEB-EVG-43: ApiConnectionSyncPage toast on successful sync', async () => {
		vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue({
			connection: apiConnectionStub(),
		});
		vi.spyOn(adminApi, 'getSyncStatus').mockResolvedValue(syncStatusStub());
		vi.spyOn(adminApi, 'listSyncLogs').mockResolvedValue({ syncLogs: [] });
		vi.spyOn(adminApi, 'triggerIdentitySync').mockResolvedValue({
			syncLog: syncLogStub(),
			connection: apiConnectionStub(),
		});

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

		await waitFor(() => screen.getByRole('button', { name: /Run dry sync/i }));
		fireEvent.click(screen.getByRole('button', { name: /Run dry sync/i }));

		await waitFor(() => {
			expect(toastMessages().some((t) => t.includes('Dry run finished'))).toBe(true);
		});
	});

	it('WEB-EVG-44: AdminUsersPage toast after create admin', async () => {
		vi.spyOn(adminApi, 'listAdminUsers')
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{
					id: 'a2',
					username: 'ops2',
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
			]);
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: 'a1', username: 'admin' },
			csrfToken: 'csrf',
		});
		vi.spyOn(adminApi, 'createAdminUser').mockResolvedValue({
			id: 'a2',
			username: 'ops2',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		});

		renderWithUi(
			<MemoryRouter initialEntries={[ADMIN_USERS_ROUTE_PREFIX]}>
				<Routes>
					<Route path={ADMIN_USERS_ROUTE_PREFIX} element={<AdminUsersPage />} />
				</Routes>
			</MemoryRouter>,
		);

		await waitFor(() => screen.getByLabelText(/^Username/));
		fireEvent.change(screen.getByLabelText(/^Username/), { target: { value: 'ops2' } });
		fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'long-password-12' } });
		fireEvent.change(screen.getByLabelText(/^Confirm password/), {
			target: { value: 'long-password-12' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Create admin' }));

		await waitFor(() => {
			expect(toastMessages().some((t) => t.includes('Admin account created'))).toBe(true);
		});
	});

	it('WEB-EVG-45: IdpSettingsPage toast after entity ID save', async () => {
		vi.spyOn(adminApi, 'getIdpSettings').mockResolvedValue({
			entityId: 'http://localhost:3000',
			nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			hasSigningCertificate: true,
			signingCertFingerprintSha256: 'aa:bb',
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
		});
		vi.spyOn(adminApi, 'updateIdpSettings').mockResolvedValue({
			entityId: 'https://idp.example.com',
			nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			hasSigningCertificate: true,
			signingCertFingerprintSha256: 'aa:bb',
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
		});

		renderWithUi(
			<MemoryRouter initialEntries={[IDP_SETTINGS_ROUTE_PREFIX]}>
				<Routes>
					<Route path={IDP_SETTINGS_ROUTE_PREFIX} element={<IdpSettingsPage />} />
				</Routes>
			</MemoryRouter>,
		);

		await waitFor(() => screen.getByDisplayValue('http://localhost:3000'));
		fireEvent.change(screen.getByLabelText(/Entity ID/i), {
			target: { value: 'https://idp.example.com' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Save entity ID' }));

		await waitFor(() => {
			expect(toastMessages().some((t) => t.includes('Entity ID updated'))).toBe(true);
		});
	});

	it('WEB-EVG-46: AuditLogPage toast after export click', async () => {
		const auditEmpty: AuditEventListResponseDto = { items: [], total: 0, limit: 50, offset: 0 };
		vi.spyOn(adminApi, 'listAuditEvents').mockResolvedValue(auditEmpty);
		vi.spyOn(adminApi, 'getCsrfToken').mockReturnValue('csrf');
		vi.spyOn(adminApi, 'auditExportUrl').mockReturnValue(
			'/api/admin/audit-events/export?format=csv',
		);

		renderWithUi(
			<MemoryRouter initialEntries={[AUDIT_ROUTE_PREFIX]}>
				<Routes>
					<Route path={AUDIT_ROUTE_PREFIX} element={<AuditLogPage />} />
				</Routes>
			</MemoryRouter>,
		);

		await waitFor(() => screen.getByRole('button', { name: /Export CSV/i }));
		fireEvent.click(screen.getByRole('button', { name: /Export CSV/i }));

		await waitFor(() => {
			expect(toastMessages().some((t) => t.includes('Export downloaded'))).toBe(true);
		});
		expect(window.open).toHaveBeenCalled();
	});
});
