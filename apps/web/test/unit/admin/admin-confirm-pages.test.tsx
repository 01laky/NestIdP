import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ApiConnectionDto, SyncLogDto } from '@nestidp/shared';
import { API_CONNECTION_ROUTE_PREFIX, IDENTITY_ROUTE_PREFIX } from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { clickDialogCancel, clickDialogConfirm } from '@test/helpers/confirm-dialog-helpers';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { ApiConnectionFormPage } from '@/admin/pages/ApiConnectionFormPage';
import { ApiConnectionSyncPage } from '@/admin/pages/ApiConnectionSyncPage';
import { IdentityGroupDetailPage } from '@/admin/pages/IdentityGroupDetailPage';
import { IdentityRoleDetailPage } from '@/admin/pages/IdentityRoleDetailPage';
import { SpConnectionFormPage } from '@/admin/pages/SpConnectionFormPage';

function apiConnectionStub(): ApiConnectionDto {
	return {
		id: 'c1',
		name: 'HR API',
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
	};
}

function syncLogStub(overrides: Partial<SyncLogDto> = {}): SyncLogDto {
	return {
		id: 'log1',
		apiConnectionId: 'c1',
		startedAt: '2026-01-01T00:00:00.000Z',
		finishedAt: '2026-01-01T00:01:00.000Z',
		durationMs: 60000,
		status: 'SUCCESS',
		usersSynced: 0,
		groupsSynced: 0,
		rolesSynced: 0,
		dryRun: true,
		triggerSource: 'manual',
		errors: null,
		...overrides,
	};
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('admin confirm page flows', () => {
	it('WEB-ADM-CONF-08: delete API connection confirm calls deleteApiConnection', async () => {
		vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue({
			connection: apiConnectionStub(),
		});
		const deleteSpy = vi
			.spyOn(adminApi, 'deleteApiConnection')
			.mockResolvedValue({ ok: true, id: 'c1' });

		renderWithUi(
			<MemoryRouter initialEntries={[`${API_CONNECTION_ROUTE_PREFIX}/c1`]}>
				<Routes>
					<Route path={`${API_CONNECTION_ROUTE_PREFIX}/:id`} element={<ApiConnectionFormPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => screen.getByRole('button', { name: 'Delete' }));
		fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		await screen.findByRole('dialog');
		clickDialogConfirm('Delete');
		await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('c1'));
	});

	it('WEB-ADM-CONF-09: delete SP confirm calls deleteSpConnection', async () => {
		vi.spyOn(adminApi, 'getSpConnection').mockResolvedValue({
			id: 'sp1',
			name: 'App',
			spEntityId: 'urn:app',
			acsUrl: 'https://app/acs',
			active: true,
			nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			attributeMapping: null,
			hasSpCertificate: false,
			wantAssertionsEncrypted: false,
			wantAuthnRequestsSigned: false,
			wantLogoutRequestsSigned: false,
			sloUrl: null,
			createdAt: '',
			updatedAt: '',
		});
		vi.spyOn(adminApi, 'updateSpConnection').mockResolvedValue({
			item: {
				id: 'sp1',
				name: 'App',
				spEntityId: 'urn:app',
				acsUrl: 'https://app/acs',
				active: false,
				nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
				attributeMapping: null,
				hasSpCertificate: false,
				wantAssertionsEncrypted: false,
				wantAuthnRequestsSigned: false,
				wantLogoutRequestsSigned: false,
				sloUrl: null,
				createdAt: '',
				updatedAt: '',
			},
		});
		const deleteSpy = vi
			.spyOn(adminApi, 'deleteSpConnection')
			.mockResolvedValue({ ok: true, id: 'sp1' });

		renderWithUi(
			<MemoryRouter initialEntries={['/admin/sp-connections/sp1']}>
				<Routes>
					<Route path="/admin/sp-connections/:id" element={<SpConnectionFormPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => screen.getByRole('button', { name: 'Deactivate & delete' }));
		fireEvent.click(screen.getByRole('button', { name: 'Deactivate & delete' }));
		await screen.findByRole('dialog');
		clickDialogConfirm('Delete');
		await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('sp1'));
	});

	it('WEB-ADM-CONF-11: delete group with members shows member names in dialog', async () => {
		vi.spyOn(adminApi, 'getIdentityGroup').mockResolvedValue({
			group: {
				id: 'g1',
				name: 'Ops',
				externalId: 'ops',
				apiConnectionId: 'loc',
				origin: 'manual',
				memberCount: 2,
			},
			members: [
				{ id: 'u1', username: 'alice', origin: 'manual' },
				{ id: 'u2', username: 'bob', origin: 'manual' },
			],
			memberCount: 2,
		});

		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/groups/g1`]}>
				<Routes>
					<Route
						path={`${IDENTITY_ROUTE_PREFIX}/groups/:id`}
						element={<IdentityGroupDetailPage />}
					/>
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => screen.getByRole('button', { name: 'Delete' }));
		fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		const dialog = await screen.findByRole('dialog');
		expect(within(dialog).getByText('alice')).toBeDefined();
		expect(within(dialog).getByText(/2 user\(s\) are members/i)).toBeDefined();
	});

	it('WEB-ADM-CONF-12: delete role with members shows preview list in dialog', async () => {
		vi.spyOn(adminApi, 'getIdentityRole').mockResolvedValue({
			role: {
				id: 'r1',
				name: 'Admin',
				externalId: 'admin',
				apiConnectionId: 'loc',
				origin: 'manual',
				memberCount: 1,
			},
			members: [{ id: 'u1', username: 'carol', origin: 'manual' }],
			memberCount: 1,
		});

		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/roles/r1`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/roles/:id`} element={<IdentityRoleDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => screen.getByRole('button', { name: 'Delete' }));
		fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		const dialog = await screen.findByRole('dialog');
		expect(within(dialog).getByText('carol')).toBeDefined();
	});

	it('WEB-ADM-CONF-15: full sync opens warning dialog; dry-run does not', async () => {
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
		vi.spyOn(adminApi, 'getSyncSchedule').mockResolvedValue({
			schedule: {
				connectionId: 'c1',
				scheduleEnabled: false,
				schedulePaused: false,
				scheduleDryRun: false,
				scheduleCron: null,
				scheduleTimezone: null,
				nextRunAt: null,
				lastScheduledRunAt: null,
				lastScheduledRunStatus: null,
				scheduleLastError: null,
				scheduleConsecutiveFailures: 0,
				scheduleAutoPausedAt: null,
				nextRuns: [],
			},
		});
		const syncSpy = vi.spyOn(adminApi, 'triggerIdentitySync').mockResolvedValue({
			syncLog: syncLogStub({ dryRun: true }),
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
		await waitFor(() => screen.getByRole('button', { name: 'Run full sync' }));
		fireEvent.click(screen.getByLabelText('Dry run (no DB writes)'));
		fireEvent.click(screen.getByRole('button', { name: 'Run dry sync' }));
		await waitFor(() => expect(syncSpy).toHaveBeenCalled());
		expect(screen.queryByRole('dialog')).toBeNull();

		syncSpy.mockClear();
		fireEvent.click(screen.getByLabelText('Dry run (no DB writes)'));
		fireEvent.click(screen.getByRole('button', { name: 'Run full sync' }));
		await screen.findByRole('dialog');
		expect(screen.getByText(/overwrites local users/i)).toBeDefined();
	});

	it('WEB-ADM-CONF-16: full sync cancel skips triggerIdentitySync', async () => {
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
		const syncSpy = vi.spyOn(adminApi, 'triggerIdentitySync');

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
		await waitFor(() => screen.getByRole('button', { name: 'Run full sync' }));
		fireEvent.click(screen.getByRole('button', { name: 'Run full sync' }));
		await screen.findByRole('dialog');
		clickDialogCancel();
		expect(syncSpy).not.toHaveBeenCalled();
	});

	it('WEB-ADM-CONF-17: delete API connection cancel skips deleteApiConnection', async () => {
		vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue({
			connection: apiConnectionStub(),
		});
		const deleteSpy = vi.spyOn(adminApi, 'deleteApiConnection');

		renderWithUi(
			<MemoryRouter initialEntries={[`${API_CONNECTION_ROUTE_PREFIX}/c1`]}>
				<Routes>
					<Route path={`${API_CONNECTION_ROUTE_PREFIX}/:id`} element={<ApiConnectionFormPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => screen.getByRole('button', { name: 'Delete' }));
		fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		await screen.findByRole('dialog');
		clickDialogCancel();
		expect(deleteSpy).not.toHaveBeenCalled();
	});

	it('WEB-ADM-CONF-18: delete SP cancel skips deleteSpConnection', async () => {
		vi.spyOn(adminApi, 'getSpConnection').mockResolvedValue({
			id: 'sp1',
			name: 'App',
			spEntityId: 'urn:app',
			acsUrl: 'https://app/acs',
			active: true,
			nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			attributeMapping: null,
			hasSpCertificate: false,
			wantAssertionsEncrypted: false,
			wantAuthnRequestsSigned: false,
			wantLogoutRequestsSigned: false,
			sloUrl: null,
			createdAt: '',
			updatedAt: '',
		});
		const deleteSpy = vi.spyOn(adminApi, 'deleteSpConnection');

		renderWithUi(
			<MemoryRouter initialEntries={['/admin/sp-connections/sp1']}>
				<Routes>
					<Route path="/admin/sp-connections/:id" element={<SpConnectionFormPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => screen.getByRole('button', { name: 'Deactivate & delete' }));
		fireEvent.click(screen.getByRole('button', { name: 'Deactivate & delete' }));
		await screen.findByRole('dialog');
		clickDialogCancel();
		expect(deleteSpy).not.toHaveBeenCalled();
	});

	it('WEB-ADM-CONF-19: full sync confirm proceeds to triggerIdentitySync', async () => {
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
		const syncSpy = vi.spyOn(adminApi, 'triggerIdentitySync').mockResolvedValue({
			syncLog: syncLogStub({ dryRun: false }),
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
		await waitFor(() => screen.getByRole('button', { name: 'Run full sync' }));
		fireEvent.click(screen.getByRole('button', { name: 'Run full sync' }));
		await screen.findByRole('dialog');
		clickDialogConfirm('Run full sync');
		await waitFor(() => expect(syncSpy).toHaveBeenCalledWith('c1', { dryRun: false }));
	});

	it('WEB-ADM-CONF-20: full sync dialog shows audit note and warning title', async () => {
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
		await waitFor(() => screen.getByRole('button', { name: 'Run full sync' }));
		fireEvent.click(screen.getByRole('button', { name: 'Run full sync' }));
		const dialog = await screen.findByRole('dialog');
		expect(within(dialog).getByRole('heading', { name: 'Run full sync?' })).toBeDefined();
		expect(within(dialog).getByText(/audit log/i)).toBeDefined();
		expect(document.querySelector('.evg-modal--warning')).not.toBeNull();
	});

	it('WEB-ADM-CONF-21: delete group with zero members has no detail list', async () => {
		vi.spyOn(adminApi, 'getIdentityGroup').mockResolvedValue({
			group: {
				id: 'g1',
				name: 'Empty',
				externalId: 'empty',
				apiConnectionId: 'loc',
				origin: 'manual',
			},
			members: [],
			memberCount: 0,
		});

		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/groups/g1`]}>
				<Routes>
					<Route
						path={`${IDENTITY_ROUTE_PREFIX}/groups/:id`}
						element={<IdentityGroupDetailPage />}
					/>
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => screen.getByRole('button', { name: 'Delete' }));
		fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		const dialog = await screen.findByRole('dialog');
		expect(dialog.querySelector('.evg-modal__detail')).toBeNull();
	});

	it('WEB-ADM-CONF-22: delete API connection dialog is danger with audit note', async () => {
		vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue({
			connection: apiConnectionStub(),
		});

		renderWithUi(
			<MemoryRouter initialEntries={[`${API_CONNECTION_ROUTE_PREFIX}/c1`]}>
				<Routes>
					<Route path={`${API_CONNECTION_ROUTE_PREFIX}/:id`} element={<ApiConnectionFormPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => screen.getByRole('button', { name: 'Delete' }));
		fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		const dialog = await screen.findByRole('dialog');
		expect(document.querySelector('.evg-modal--danger')).not.toBeNull();
		expect(within(dialog).getByText(/audit log/i)).toBeDefined();
		expect(within(dialog).getByRole('button', { name: 'Delete' }).className).toContain(
			'evg-btn--danger',
		);
	});

	it('WEB-ADM-CONF-23: inactive SP skips updateSpConnection before delete', async () => {
		vi.spyOn(adminApi, 'getSpConnection').mockResolvedValue({
			id: 'sp1',
			name: 'App',
			spEntityId: 'urn:app',
			acsUrl: 'https://app/acs',
			active: false,
			nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
			attributeMapping: null,
			hasSpCertificate: false,
			wantAssertionsEncrypted: false,
			wantAuthnRequestsSigned: false,
			wantLogoutRequestsSigned: false,
			sloUrl: null,
			createdAt: '',
			updatedAt: '',
		});
		const updateSpy = vi.spyOn(adminApi, 'updateSpConnection');
		const deleteSpy = vi
			.spyOn(adminApi, 'deleteSpConnection')
			.mockResolvedValue({ ok: true, id: 'sp1' });

		renderWithUi(
			<MemoryRouter initialEntries={['/admin/sp-connections/sp1']}>
				<Routes>
					<Route path="/admin/sp-connections/:id" element={<SpConnectionFormPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => screen.getByRole('button', { name: 'Deactivate & delete' }));
		fireEvent.click(screen.getByRole('button', { name: 'Deactivate & delete' }));
		await screen.findByRole('dialog');
		clickDialogConfirm('Delete');
		await waitFor(() => expect(deleteSpy).toHaveBeenCalled());
		expect(updateSpy).not.toHaveBeenCalled();
	});
});
