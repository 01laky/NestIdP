import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { SyncLogDetailPage } from '@/admin/pages/SyncLogDetailPage';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('SyncLogDetailPage Evergreen forms', () => {
	it('WEB-EVG-87: errors block uses CodeBlock', async () => {
		vi.spyOn(adminApi, 'getSyncLog').mockResolvedValue({
			syncLog: {
				id: 'log-1',
				apiConnectionId: 'c1',
				startedAt: '2026-01-01T00:00:00.000Z',
				finishedAt: '2026-01-01T00:01:00.000Z',
				durationMs: 60_000,
				status: 'FAILED',
				usersSynced: 0,
				groupsSynced: 0,
				rolesSynced: 0,
				dryRun: false,
				errors: [{ phase: 'user_limit', message: 'boom' }],
			},
		});

		const { container } = render(
			<MemoryRouter initialEntries={['/admin/sync-logs/log-1']}>
				<Routes>
					<Route path="/admin/sync-logs/:syncLogId" element={<SyncLogDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);

		await waitFor(() => screen.getByText('FAILED'));
		expect(container.querySelector('pre.evg-code-block')).not.toBeNull();
	});
});
