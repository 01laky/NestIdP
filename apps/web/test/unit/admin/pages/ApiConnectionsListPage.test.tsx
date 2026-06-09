import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiConnectionDto } from '@nestidp/shared';
import * as adminApi from '@/admin/adminApi';
import { renderWithUi, initTestI18n } from '@test/helpers/renderWithUi';
import { ApiConnectionsListPage } from '@/admin/pages/ApiConnectionsListPage';

function connection(overrides: Partial<ApiConnectionDto> = {}): ApiConnectionDto {
	return {
		id: 'conn-1',
		name: 'HR API',
		baseUrl: 'https://hr.example.com',
		authType: 'BEARER',
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
		lastSyncStatus: 'SUCCESS',
		isLocalDirectory: false,
		includeInSyncAll: true,
		usernameCollisionPolicy: null,
		lastCollisionCount: 2,
		syncedUserCount: 12,
		syncedGroupCount: 3,
		syncedRoleCount: 1,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

beforeAll(async () => {
	await initTestI18n();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function render() {
	return renderWithUi(
		<MemoryRouter>
			<ApiConnectionsListPage />
		</MemoryRouter>,
	);
}

describe('ApiConnectionsListPage — multi-source (WEB-MAS)', () => {
	beforeEach(() => {
		vi.spyOn(adminApi, 'listApiConnections').mockResolvedValue({ connections: [connection()] });
	});

	it('WEB-MAS-03: renders per-source counts + last-collision and triggers "Sync all sources"', async () => {
		const syncAll = vi.spyOn(adminApi, 'syncAllSources').mockResolvedValue({
			dryRun: false,
			results: [
				{
					connectionId: 'conn-1',
					name: 'HR API',
					status: 'succeeded',
					usersSynced: 12,
					groupsSynced: 3,
					rolesSynced: 1,
					usersSkippedCollision: 0,
				},
			],
			totals: {
				connections: 1,
				succeeded: 1,
				failed: 0,
				skippedInProgress: 0,
				excluded: 0,
				usersSynced: 12,
				usersSkippedCollision: 0,
			},
		});
		render();
		await waitFor(() => expect(screen.getByText('HR API')).toBeDefined());

		// per-source counts + collision marker
		expect(screen.getByText(/12 users · 3 groups · 1 roles/)).toBeDefined();
		expect(screen.getByText(/collision/i)).toBeDefined();

		fireEvent.click(screen.getByRole('button', { name: 'Sync all sources' }));
		await waitFor(() => expect(syncAll).toHaveBeenCalledWith({ dryRun: false }));
	});

	it('WEB-MAS-03b: "Dry-run all" calls the bulk endpoint in dry-run mode', async () => {
		const syncAll = vi.spyOn(adminApi, 'syncAllSources').mockResolvedValue({
			dryRun: true,
			results: [],
			totals: {
				connections: 0,
				succeeded: 0,
				failed: 0,
				skippedInProgress: 0,
				excluded: 0,
				usersSynced: 0,
				usersSkippedCollision: 0,
			},
		});
		render();
		await waitFor(() => expect(screen.getByText('HR API')).toBeDefined());

		fireEvent.click(screen.getByRole('button', { name: 'Dry-run all' }));
		await waitFor(() => expect(syncAll).toHaveBeenCalledWith({ dryRun: true }));
	});
});
