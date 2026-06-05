import { cleanup, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { API_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { ApiConnectionSyncPage } from '@/admin/pages/ApiConnectionSyncPage';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('ApiConnectionSyncPage Evergreen forms', () => {
	it('WEB-EVG-82: dry-run Checkbox', async () => {
		vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue({
			connection: {
				id: 'c1',
				name: 'HR',
				baseUrl: 'https://api.example.com',
				authType: 'BEARER',
				hasBearerToken: true,
				lastSyncAt: null,
				lastSyncStatus: 'NEVER',
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
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

		await waitFor(() => {
			expect(screen.getByRole('checkbox', { name: /Dry run/i })).toBeDefined();
		});
	});
});
