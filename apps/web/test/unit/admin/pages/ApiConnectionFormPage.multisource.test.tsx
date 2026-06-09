import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { API_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { ApiConnectionFormPage } from '@/admin/pages/ApiConnectionFormPage';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function renderNewForm() {
	return renderWithUi(
		<MemoryRouter initialEntries={[`${API_CONNECTION_ROUTE_PREFIX}/new`]}>
			<Routes>
				<Route path={`${API_CONNECTION_ROUTE_PREFIX}/new`} element={<ApiConnectionFormPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

function renderEditForm() {
	return renderWithUi(
		<MemoryRouter initialEntries={[`${API_CONNECTION_ROUTE_PREFIX}/c1`]}>
			<Routes>
				<Route path={`${API_CONNECTION_ROUTE_PREFIX}/:id`} element={<ApiConnectionFormPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

function connectionStub(overrides: Record<string, unknown> = {}) {
	return {
		connection: {
			id: 'c1',
			name: 'HR API',
			baseUrl: 'https://api.corp.example',
			authType: 'BEARER' as const,
			hasBearerToken: true,
			apiContractConfig: null,
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
			lastSyncAt: null,
			lastSyncStatus: 'NEVER' as const,
			isLocalDirectory: false,
			includeInSyncAll: true,
			usernameCollisionPolicy: null,
			lastCollisionCount: 0,
			syncedUserCount: 0,
			syncedGroupCount: 0,
			syncedRoleCount: 0,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
			...overrides,
		},
	};
}

describe('ApiConnectionFormPage — multi-source sync (Prompt 37)', () => {
	it('WEB-MAS-FORM-01: create sends includeInSyncAll + usernameCollisionPolicy override', async () => {
		const create = vi
			.spyOn(adminApi, 'createApiConnection')
			.mockResolvedValue({ connection: { id: 'c1' } } as never);
		renderNewForm();

		fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'HR API' } });
		fireEvent.change(screen.getByLabelText(/^Base URL/i), {
			target: { value: 'https://api.corp.example' },
		});
		fireEvent.change(screen.getByLabelText(/Bearer token/i), { target: { value: 'tok' } });

		// default toggle is on → turn it off
		fireEvent.click(screen.getByLabelText(/Include in/i));
		fireEvent.change(screen.getByLabelText(/Username collision policy/i), {
			target: { value: 'fail_run' },
		});

		fireEvent.click(screen.getByRole('button', { name: /Save/i }));
		await waitFor(() => expect(create).toHaveBeenCalled());
		const body = create.mock.calls[0][0] as unknown as Record<string, unknown>;
		expect(body).toMatchObject({
			includeInSyncAll: false,
			usernameCollisionPolicy: 'fail_run',
		});
	});

	it('WEB-MAS-FORM-01b: create with inherit policy sends usernameCollisionPolicy null', async () => {
		const create = vi
			.spyOn(adminApi, 'createApiConnection')
			.mockResolvedValue({ connection: { id: 'c1' } } as never);
		renderNewForm();
		fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'HR API' } });
		fireEvent.change(screen.getByLabelText(/^Base URL/i), {
			target: { value: 'https://api.corp.example' },
		});
		fireEvent.change(screen.getByLabelText(/Bearer token/i), { target: { value: 'tok' } });
		fireEvent.click(screen.getByRole('button', { name: /Save/i }));
		await waitFor(() => expect(create).toHaveBeenCalled());
		const body = create.mock.calls[0][0] as unknown as Record<string, unknown>;
		expect(body).toMatchObject({ includeInSyncAll: true, usernameCollisionPolicy: null });
	});

	it('WEB-MAS-FORM-02: re-bind (baseUrl change with synced identities) confirms then sends acknowledgeRebind', async () => {
		vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue(
			connectionStub({ syncedUserCount: 5 }) as never,
		);
		const update = vi
			.spyOn(adminApi, 'updateApiConnection')
			.mockResolvedValue({ connection: { id: 'c1' } } as never);
		renderEditForm();
		await screen.findByDisplayValue('https://api.corp.example');

		fireEvent.change(screen.getByLabelText(/^Base URL/i), {
			target: { value: 'https://api.new.example' },
		});
		fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

		// confirm dialog appears
		await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined());
		expect(update).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

		await waitFor(() => expect(update).toHaveBeenCalled());
		const body = update.mock.calls[0][1] as unknown as Record<string, unknown>;
		expect(body).toMatchObject({ baseUrl: 'https://api.new.example', acknowledgeRebind: true });
	});

	it('WEB-MAS-FORM-03: editing without re-bind does not require acknowledgement', async () => {
		vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue(
			connectionStub({ syncedUserCount: 5 }) as never,
		);
		const update = vi
			.spyOn(adminApi, 'updateApiConnection')
			.mockResolvedValue({ connection: { id: 'c1' } } as never);
		renderEditForm();
		await screen.findByDisplayValue('https://api.corp.example');

		// change only the name → no re-bind
		fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'HR API renamed' } });
		fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

		await waitFor(() => expect(update).toHaveBeenCalled());
		expect(screen.queryByRole('dialog')).toBeNull();
		const body = update.mock.calls[0][1] as unknown as Record<string, unknown>;
		expect(body).not.toHaveProperty('acknowledgeRebind');
	});

	it('WEB-MAS-FORM-04: Remove identities (deactivate) calls the endpoint after confirm', async () => {
		vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue(
			connectionStub({ syncedUserCount: 3, syncedGroupCount: 1 }) as never,
		);
		const remove = vi.spyOn(adminApi, 'removeSourceIdentities').mockResolvedValue({
			ok: true,
			mode: 'deactivate',
			usersRemoved: 3,
			groupsRemoved: 1,
			rolesRemoved: 0,
			sessionsTerminated: 2,
		});
		renderEditForm();
		await screen.findByDisplayValue('https://api.corp.example');

		fireEvent.click(screen.getByRole('button', { name: 'Deactivate (keep rows)' }));
		// confirm dialog → its confirm button shares the label; click the last one
		await waitFor(() =>
			expect(
				screen.getAllByRole('button', { name: 'Deactivate (keep rows)' }).length,
			).toBeGreaterThan(1),
		);
		const buttons = screen.getAllByRole('button', { name: 'Deactivate (keep rows)' });
		fireEvent.click(buttons[buttons.length - 1]);

		await waitFor(() => expect(remove).toHaveBeenCalledWith('c1', 'deactivate'));
	});

	it('WEB-MAS-FORM-05: local directory hides sync-settings + remove-identities', async () => {
		vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue(
			connectionStub({
				isLocalDirectory: true,
				syncedUserCount: 4,
				name: 'Local directory',
				baseUrl: 'https://local.nestidp/manual',
			}) as never,
		);
		renderEditForm();
		await screen.findByDisplayValue('Local directory');

		expect(screen.queryByLabelText(/Include in/i)).toBeNull();
		expect(screen.queryByLabelText(/Username collision policy/i)).toBeNull();
		expect(screen.queryByRole('button', { name: 'Deactivate (keep rows)' })).toBeNull();
	});

	it('WEB-MAS-FORM-06: no synced identities → no remove-identities actions', async () => {
		vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue(connectionStub() as never);
		renderEditForm();
		await screen.findByDisplayValue('https://api.corp.example');
		expect(screen.queryByRole('button', { name: 'Deactivate (keep rows)' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Delete rows' })).toBeNull();
	});
});
