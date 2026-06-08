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

describe('ApiConnectionFormPage Evergreen forms', () => {
	it('WEB-EVG-75: renders TextInput labels Name and Base URL', () => {
		renderNewForm();
		expect(screen.getByLabelText(/^Name/i)).toBeDefined();
		expect(screen.getByLabelText(/^Base URL/i)).toBeDefined();
	});

	it('WEB-EVG-76: Save uses evg-btn--primary', () => {
		renderNewForm();
		const save = screen.getByRole('button', { name: /Save/i });
		expect(save.className).toContain('evg-btn--primary');
	});

	it('WEB-EVG-101: disables fields and submit while saving', async () => {
		let resolveCreate!: (value: Awaited<ReturnType<typeof adminApi.createApiConnection>>) => void;
		vi.spyOn(adminApi, 'createApiConnection').mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveCreate = resolve;
				}),
		);

		renderNewForm();
		fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'HR' } });
		fireEvent.change(screen.getByLabelText(/^Base URL/i), {
			target: { value: 'https://api.example.com' },
		});
		fireEvent.change(screen.getByLabelText(/Bearer token/i), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('button', { name: /Save/i }));

		await waitFor(() => {
			const fieldset = screen.getByLabelText(/^Name/i).closest('fieldset');
			expect(fieldset?.hasAttribute('disabled')).toBe(true);
		});

		resolveCreate({
			connection: {
				id: 'c1',
				name: 'HR',
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
			},
		});
	});
});
