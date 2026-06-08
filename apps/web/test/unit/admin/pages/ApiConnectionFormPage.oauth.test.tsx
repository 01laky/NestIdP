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

function oauthConnectionStub() {
	return {
		connection: {
			id: 'c1',
			name: 'OAuth API',
			baseUrl: 'https://id.example.com',
			authType: 'OAUTH2_CLIENT_CREDENTIALS' as const,
			hasBearerToken: false,
			apiContractConfig: null,
			oauthTokenUrl: 'https://idp.example.com/oauth/token',
			oauthClientId: 'client-1',
			oauthScope: 'read',
			oauthAudience: null,
			oauthClientAuthMethod: 'client_secret_post' as const,
			oauthTokenRequestParams: null,
			hasOauthClientSecret: true,
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
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		},
	};
}

describe('ApiConnectionFormPage — OAuth 2.0 Client Credentials', () => {
	it('WEB-OAUTH-01: switching auth type toggles between Bearer and OAuth fields', () => {
		renderNewForm();
		expect(screen.getByLabelText(/Bearer token/i)).toBeDefined();
		fireEvent.change(screen.getByLabelText(/Authentication/i), {
			target: { value: 'OAUTH2_CLIENT_CREDENTIALS' },
		});
		expect(screen.getByLabelText(/Token URL/i)).toBeDefined();
		expect(screen.getByLabelText(/Client ID/i)).toBeDefined();
		expect(screen.queryByLabelText(/^Bearer token/i)).toBeNull();
	});

	it('WEB-OAUTH-02: create sends the OAuth DTO (authType + token url + secret)', async () => {
		const create = vi
			.spyOn(adminApi, 'createApiConnection')
			.mockResolvedValue({ connection: { id: 'c1' } } as never);
		renderNewForm();
		fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'OAuth API' } });
		fireEvent.change(screen.getByLabelText(/^Base URL/i), {
			target: { value: 'https://id.example.com' },
		});
		fireEvent.change(screen.getByLabelText(/Authentication/i), {
			target: { value: 'OAUTH2_CLIENT_CREDENTIALS' },
		});
		fireEvent.change(screen.getByLabelText(/Token URL/i), {
			target: { value: 'https://idp.example.com/oauth/token' },
		});
		fireEvent.change(screen.getByLabelText(/Client ID/i), { target: { value: 'client-1' } });
		fireEvent.change(screen.getByLabelText(/Client secret/i), { target: { value: 'the-secret' } });
		fireEvent.click(screen.getByRole('button', { name: /Save/i }));
		await waitFor(() => expect(create).toHaveBeenCalled());
		const body = create.mock.calls[0][0];
		expect(body.authType).toBe('OAUTH2_CLIENT_CREDENTIALS');
		expect(body.oauthTokenUrl).toBe('https://idp.example.com/oauth/token');
		expect(body.oauthClientSecret).toBe('the-secret');
		expect(body).not.toHaveProperty('bearerToken');
	});

	it('WEB-OAUTH-03: edit prefills non-secret OAuth fields; secret blank ("keep")', async () => {
		vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue(oauthConnectionStub() as never);
		const update = vi.spyOn(adminApi, 'updateApiConnection').mockResolvedValue({} as never);
		renderEditForm();
		await waitFor(() =>
			expect((screen.getByLabelText(/Token URL/i) as HTMLInputElement).value).toBe(
				'https://idp.example.com/oauth/token',
			),
		);
		expect((screen.getByLabelText(/Client ID/i) as HTMLInputElement).value).toBe('client-1');
		fireEvent.click(screen.getByRole('button', { name: /Save/i }));
		await waitFor(() => expect(update).toHaveBeenCalled());
		// secret left blank → not sent (keep existing)
		expect(update.mock.calls[0][1]).not.toHaveProperty('oauthClientSecret');
	});

	it('WEB-OAUTH-04: Test token surfaces masked diagnostics', async () => {
		vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue(oauthConnectionStub() as never);
		vi.spyOn(adminApi, 'testApiConnectionToken').mockResolvedValue({
			ok: true,
			reachable: true,
			statusCode: 200,
			tokenType: 'Bearer',
			expiresIn: 3600,
		} as never);
		renderEditForm();
		await waitFor(() => expect(screen.getByRole('button', { name: /Test token/i })).toBeDefined());
		fireEvent.click(screen.getByRole('button', { name: /Test token/i }));
		await waitFor(() => expect(screen.getByText(/Token obtained/i)).toBeDefined());
	});

	it('WEB-OAUTH-05: invalid extra-params JSON blocks submit with an error', async () => {
		const create = vi
			.spyOn(adminApi, 'createApiConnection')
			.mockResolvedValue({ connection: { id: 'c1' } } as never);
		renderNewForm();
		fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'OAuth API' } });
		fireEvent.change(screen.getByLabelText(/^Base URL/i), {
			target: { value: 'https://id.example.com' },
		});
		fireEvent.change(screen.getByLabelText(/Authentication/i), {
			target: { value: 'OAUTH2_CLIENT_CREDENTIALS' },
		});
		fireEvent.change(screen.getByLabelText(/Token URL/i), {
			target: { value: 'https://idp.example.com/oauth/token' },
		});
		fireEvent.change(screen.getByLabelText(/Client ID/i), { target: { value: 'client-1' } });
		fireEvent.change(screen.getByLabelText(/Client secret/i), { target: { value: 's' } });
		fireEvent.change(screen.getByLabelText(/Extra token params/i), {
			target: { value: '{ not json' },
		});
		fireEvent.click(screen.getByRole('button', { name: /Save/i }));
		await waitFor(() => expect(screen.getByText(/not valid JSON/i)).toBeDefined());
		expect(create).not.toHaveBeenCalled();
	});

	it('WEB-OAUTH-06: switching OAuth → back to Bearer restores the bearer field', () => {
		renderNewForm();
		fireEvent.change(screen.getByLabelText('Authentication'), {
			target: { value: 'OAUTH2_CLIENT_CREDENTIALS' },
		});
		expect(screen.getByLabelText(/Token URL/i)).toBeDefined();
		fireEvent.change(screen.getByLabelText('Authentication'), { target: { value: 'BEARER' } });
		expect(screen.getByLabelText(/Bearer token/i)).toBeDefined();
		expect(screen.queryByLabelText(/Token URL/i)).toBeNull();
	});
});
