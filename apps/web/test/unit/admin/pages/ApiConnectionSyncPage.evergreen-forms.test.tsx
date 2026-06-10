import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { API_CONNECTION_ROUTE_PREFIX, type SyncLogDto } from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { ApiConnectionSyncPage } from '@/admin/pages/ApiConnectionSyncPage';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function mockSyncPageApis() {
	vi.spyOn(adminApi, 'getApiConnection').mockResolvedValue({
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
	vi.spyOn(adminApi, 'getSyncStatus').mockResolvedValue({
		connectionId: 'c1',
		lastSyncAt: null,
		lastSyncStatus: 'NEVER',
		syncInProgress: false,
		latestSyncLog: null,
	});
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
	return vi.spyOn(adminApi, 'listSyncLogs');
}

function renderPage() {
	return renderWithUi(
		<MemoryRouter initialEntries={[`${API_CONNECTION_ROUTE_PREFIX}/c1/sync`]}>
			<Routes>
				<Route
					path={`${API_CONNECTION_ROUTE_PREFIX}/:id/sync`}
					element={<ApiConnectionSyncPage />}
				/>
			</Routes>
		</MemoryRouter>,
	);
}

describe('ApiConnectionSyncPage Evergreen forms', () => {
	it('WEB-EVG-82: dry-run Checkbox', async () => {
		mockSyncPageApis().mockResolvedValue({ syncLogs: [] });

		renderPage();

		await waitFor(() => {
			expect(screen.getByRole('checkbox', { name: 'Dry run (no DB writes)' })).toBeDefined();
		});
	});

	it('WEB-SYNC-09: stale log-filter response cannot overwrite a newer selection', async () => {
		const baseLog = {
			apiConnectionId: 'c1',
			finishedAt: null,
			durationMs: null,
			status: 'SUCCESS' as const,
			usersSynced: 1,
			groupsSynced: 0,
			rolesSynced: 0,
			dryRun: false,
			errors: null,
		};
		const manualLog: SyncLogDto = {
			...baseLog,
			id: 'log-manual',
			startedAt: '2026-03-01T00:00:00.000Z',
			triggerSource: 'manual',
		};
		const scheduledLog: SyncLogDto = {
			...baseLog,
			id: 'log-sched',
			startedAt: '2026-04-01T00:00:00.000Z',
			triggerSource: 'scheduled',
		};

		let resolveManual!: (value: { syncLogs: SyncLogDto[] }) => void;
		mockSyncPageApis()
			// Initial reload on mount.
			.mockResolvedValueOnce({ syncLogs: [] })
			// Slow response for the 'manual' filter.
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveManual = resolve;
					}),
			)
			// Fast response for the newer 'scheduled' filter.
			.mockResolvedValueOnce({ syncLogs: [scheduledLog] });

		renderPage();
		await waitFor(() => screen.getByLabelText('Source'));

		fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'manual' } });
		fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'scheduled' } });

		await waitFor(() => {
			expect(screen.getByText(/2026-04-01/)).toBeDefined();
		});

		// The slow 'manual' response arrives last but must be discarded.
		await act(async () => {
			resolveManual({ syncLogs: [manualLog] });
			await Promise.resolve();
		});

		expect(screen.queryByText(/2026-03-01/)).toBeNull();
		expect(screen.getByText(/2026-04-01/)).toBeDefined();
	});
});
