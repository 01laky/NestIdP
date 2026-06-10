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
				groupsDeactivated: 0,
				rolesDeactivated: 0,
				dryRun: false,
				triggerSource: 'manual',
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

	it('WEB-ADM-110: shows groupsDeactivated/rolesDeactivated counts when persisted', async () => {
		vi.spyOn(adminApi, 'getSyncLog').mockResolvedValue({
			syncLog: {
				id: 'log-2',
				apiConnectionId: 'c1',
				startedAt: '2026-01-01T00:00:00.000Z',
				finishedAt: '2026-01-01T00:01:00.000Z',
				durationMs: 60_000,
				status: 'SUCCESS',
				usersSynced: 10,
				groupsSynced: 5,
				rolesSynced: 3,
				groupsDeactivated: 4,
				rolesDeactivated: 2,
				dryRun: false,
				triggerSource: 'manual',
				errors: null,
			},
		});

		render(
			<MemoryRouter initialEntries={['/admin/sync-logs/log-2']}>
				<Routes>
					<Route path="/admin/sync-logs/:syncLogId" element={<SyncLogDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);

		await waitFor(() => screen.getByText('SUCCESS'));
		expect(screen.getByText('Groups deactivated')).toBeDefined();
		expect(screen.getByText('Roles deactivated')).toBeDefined();
		expect(screen.getByText('4')).toBeDefined();
		expect(screen.getByText('2')).toBeDefined();
	});

	it('WEB-ADM-111: legacy rows with null deactivation counts render an em-dash', async () => {
		vi.spyOn(adminApi, 'getSyncLog').mockResolvedValue({
			syncLog: {
				id: 'log-3',
				apiConnectionId: 'c1',
				startedAt: '2026-01-01T00:00:00.000Z',
				finishedAt: '2026-01-01T00:01:00.000Z',
				durationMs: 60_000,
				status: 'SUCCESS',
				usersSynced: 10,
				groupsSynced: 5,
				rolesSynced: 3,
				groupsDeactivated: null,
				rolesDeactivated: null,
				dryRun: false,
				triggerSource: 'manual',
				errors: null,
			},
		});

		render(
			<MemoryRouter initialEntries={['/admin/sync-logs/log-3']}>
				<Routes>
					<Route path="/admin/sync-logs/:syncLogId" element={<SyncLogDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);

		await waitFor(() => screen.getByText('SUCCESS'));
		// finishedAt is set, so the only em-dashes are the two legacy deactivation counts.
		expect(screen.getAllByText('—')).toHaveLength(2);
	});
});
