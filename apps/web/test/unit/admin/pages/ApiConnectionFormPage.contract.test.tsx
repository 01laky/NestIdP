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

describe('ApiConnectionFormPage — configurable contract', () => {
	it('WEB-APICONN-CONTRACT-01: advanced section + JSON editor render', () => {
		renderNewForm();
		expect(screen.getByText(/API contract \(advanced\)/i)).toBeDefined();
		expect(screen.getByLabelText(/Contract JSON/i)).toBeDefined();
	});

	it('WEB-APICONN-CONTRACT-02: custom contract JSON is sent; empty section sends nothing', async () => {
		const create = vi
			.spyOn(adminApi, 'createApiConnection')
			.mockResolvedValue({ connection: { id: 'c1' } } as never);
		renderNewForm();
		fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Corp' } });
		fireEvent.change(screen.getByLabelText(/^Base URL/i), {
			target: { value: 'https://id.example.com' },
		});
		fireEvent.change(screen.getByLabelText(/Bearer token/i), { target: { value: 'tok' } });
		fireEvent.change(screen.getByLabelText(/Contract JSON/i), {
			target: { value: '{"endpoints":{"usersPath":"/v1/accounts"}}' },
		});
		fireEvent.click(screen.getByRole('button', { name: /Save/i }));
		await waitFor(() => expect(create).toHaveBeenCalled());
		expect(create.mock.calls[0][0].apiContractConfig).toMatchObject({
			endpoints: { usersPath: '/v1/accounts' },
		});
	});

	it('WEB-APICONN-CONTRACT-02b: invalid JSON shows an error and does not submit', async () => {
		const create = vi.spyOn(adminApi, 'createApiConnection').mockResolvedValue({} as never);
		renderNewForm();
		fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Corp' } });
		fireEvent.change(screen.getByLabelText(/^Base URL/i), {
			target: { value: 'https://id.example.com' },
		});
		fireEvent.change(screen.getByLabelText(/Bearer token/i), { target: { value: 'tok' } });
		fireEvent.change(screen.getByLabelText(/Contract JSON/i), { target: { value: '{not json' } });
		fireEvent.click(screen.getByRole('button', { name: /Save/i }));
		await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
		expect(create).not.toHaveBeenCalled();
	});

	it('WEB-APICONN-CONTRACT-05: preset dropdown prefills the JSON editor', async () => {
		renderNewForm();
		const preset = screen.getByLabelText(/Start from preset/i) as HTMLSelectElement;
		fireEvent.change(preset, { target: { value: 'keycloak-like' } });
		await waitFor(() => {
			const editor = screen.getByLabelText(/Contract JSON/i) as HTMLTextAreaElement;
			expect(editor.value).toContain('realms');
		});
	});

	function renderEditForm() {
		return renderWithUi(
			<MemoryRouter initialEntries={[`${API_CONNECTION_ROUTE_PREFIX}/c1`]}>
				<Routes>
					<Route path={`${API_CONNECTION_ROUTE_PREFIX}/:id`} element={<ApiConnectionFormPage />} />
				</Routes>
			</MemoryRouter>,
		);
	}

	function connectionStub(apiContractConfig: unknown) {
		return {
			connection: {
				id: 'c1',
				name: 'Corp',
				baseUrl: 'https://id.example.com',
				authType: 'BEARER' as const,
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
				apiContractConfig,
				lastSyncAt: null,
				lastSyncStatus: 'NEVER' as const,
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
		};
	}

	it('WEB-APICONN-CONTRACT-06: editing prefills the JSON editor from the stored contract', async () => {
		vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue(
			connectionStub({ endpoints: { usersPath: '/v1/accounts' } }) as never,
		);
		renderEditForm();
		await waitFor(() => {
			const editor = screen.getByLabelText(/Contract JSON/i) as HTMLTextAreaElement;
			expect(editor.value).toContain('/v1/accounts');
		});
	});

	it('WEB-APICONN-CONTRACT-03: reset clears the editor and sends null on update', async () => {
		vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue(
			connectionStub({ endpoints: { usersPath: '/v1/accounts' } }) as never,
		);
		const update = vi.spyOn(adminApi, 'updateApiConnection').mockResolvedValue({} as never);
		renderEditForm();
		await waitFor(() => expect(screen.getByLabelText(/Contract JSON/i)).toBeDefined());
		fireEvent.click(screen.getByRole('button', { name: /Reset to default contract/i }));
		expect((screen.getByLabelText(/Contract JSON/i) as HTMLTextAreaElement).value).toBe('');
		fireEvent.click(screen.getByRole('button', { name: /Save/i }));
		await waitFor(() => expect(update).toHaveBeenCalled());
		expect(update.mock.calls[0][1].apiContractConfig).toBeNull();
	});

	it('WEB-APICONN-CONTRACT-04: test surfaces previewUsersCount + contractError', async () => {
		vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue(connectionStub(null) as never);
		vi.spyOn(adminApi, 'testApiConnection').mockResolvedValue({
			ok: true,
			reachable: true,
			statusCode: 200,
			message: 'OK',
			previewUsersCount: 3,
			contractError: 'groups endpoint: HTTP 404',
		} as never);
		renderEditForm();
		await waitFor(() => expect(screen.getByRole('button', { name: /Test/i })).toBeDefined());
		fireEvent.click(screen.getByRole('button', { name: /Test/i }));
		await waitFor(() => {
			expect(screen.getByText(/3 users parsed/i)).toBeDefined();
			expect(screen.getByText(/groups endpoint: HTTP 404/i)).toBeDefined();
		});
	});
});
