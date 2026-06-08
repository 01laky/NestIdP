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

function proxyConnectionStub(overrides: Record<string, unknown> = {}) {
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
			proxyEnabled: true,
			proxyUrl: 'http://proxy.corp.example:8080',
			proxyUsername: 'puser',
			hasProxyPassword: true,
			noProxyHosts: '.corp.example',
			lastProxyCheckStatus: null,
			lastProxyCheckAt: null,
			lastSyncAt: null,
			lastSyncStatus: 'NEVER' as const,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
			...overrides,
		},
	};
}

describe('ApiConnectionFormPage — outbound proxy', () => {
	it('WEB-PROXY-01: create sends proxy fields; password only when typed; masked input', async () => {
		const create = vi
			.spyOn(adminApi, 'createApiConnection')
			.mockResolvedValue({ connection: { id: 'c1' } } as never);
		renderNewForm();

		fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'HR API' } });
		fireEvent.change(screen.getByLabelText(/^Base URL/i), {
			target: { value: 'https://api.other.example' },
		});
		fireEvent.change(screen.getByLabelText(/Bearer token/i), { target: { value: 'tok' } });

		fireEvent.click(screen.getByLabelText(/Enable proxy/i));
		fireEvent.change(screen.getByLabelText(/Proxy URL/i), {
			target: { value: 'http://proxy.corp.example:8080' },
		});
		fireEvent.change(screen.getByLabelText(/Proxy username/i), { target: { value: 'puser' } });
		const pw = screen.getByLabelText(/Proxy password/i) as HTMLInputElement;
		expect(pw.type).toBe('password');
		fireEvent.change(pw, { target: { value: 'psecret' } });
		fireEvent.change(screen.getByLabelText(/No-proxy hosts/i), {
			target: { value: '.corp.example, 10.0.0.0/8' },
		});

		fireEvent.click(screen.getByRole('button', { name: /Save/i }));
		await waitFor(() => expect(create).toHaveBeenCalled());
		const body = create.mock.calls[0][0] as unknown as Record<string, unknown>;
		expect(body).toMatchObject({
			proxyEnabled: true,
			proxyUrl: 'http://proxy.corp.example:8080',
			proxyUsername: 'puser',
			proxyPassword: 'psecret',
			noProxyHosts: '.corp.example, 10.0.0.0/8',
		});
	});

	it('WEB-PROXY-01b: edit omits proxyPassword when left blank (leave-blank-to-keep)', async () => {
		vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue(proxyConnectionStub() as never);
		const update = vi
			.spyOn(adminApi, 'updateApiConnection')
			.mockResolvedValue({ connection: { id: 'c1' } } as never);
		renderEditForm();
		await screen.findByDisplayValue('http://proxy.corp.example:8080');

		fireEvent.click(screen.getByRole('button', { name: /Save/i }));
		await waitFor(() => expect(update).toHaveBeenCalled());
		const body = update.mock.calls[0][1] as unknown as Record<string, unknown>;
		expect(body).not.toHaveProperty('proxyPassword');
		expect(body).toMatchObject({ proxyEnabled: true });
	});

	it('WEB-PROXY-02: effective-routing preview + Test proxy result + health badge', async () => {
		vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue(proxyConnectionStub() as never);
		vi.spyOn(adminApi, 'testApiConnectionProxy').mockResolvedValue({
			ok: true,
			status: 'ok',
			message: 'Reached the target through the proxy (HTTP 200)',
			viaProxy: true,
			bypassed: false,
			proxyHost: 'proxy.corp.example:8080',
		} as never);
		renderEditForm();
		await screen.findByDisplayValue('http://proxy.corp.example:8080');

		// baseUrl host api.corp.example is bypassed by `.corp.example` → direct
		expect(screen.getByText('api.corp.example')).toBeDefined();
		expect(screen.getAllByText(/direct/i).length).toBeGreaterThan(0);

		fireEvent.click(screen.getByRole('button', { name: /Test proxy/i }));
		await waitFor(() =>
			expect(screen.getByText(/Reached the target through the proxy/i)).toBeDefined(),
		);
		expect(screen.getByText(/Proxy health/i)).toBeDefined();
	});
});
