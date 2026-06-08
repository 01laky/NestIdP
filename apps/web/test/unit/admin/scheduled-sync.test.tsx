import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { API_CONNECTION_ROUTE_PREFIX, type ApiConnectionScheduleDto } from '@nestidp/shared';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { ScheduleSection } from '@/admin/components/sync/ScheduleSection';
import { SyncSchedulesPage } from '@/admin/pages/SyncSchedulesPage';
import { ApiConnectionSyncPage } from '@/admin/pages/ApiConnectionSyncPage';
import { renderWithUi, initTestI18n } from '@test/helpers/renderWithUi';

beforeAll(async () => {
	await initTestI18n();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function scheduleDto(overrides: Partial<ApiConnectionScheduleDto> = {}): ApiConnectionScheduleDto {
	return {
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
		...overrides,
	};
}

describe('WEB-SCHED-01: schedule form', () => {
	it('loads an enabled schedule, previews next runs, and shows the status row', async () => {
		vi.spyOn(adminApi, 'getSyncSchedule').mockResolvedValue({
			schedule: scheduleDto({
				scheduleEnabled: true,
				scheduleCron: '*/15 * * * *',
				scheduleTimezone: 'UTC',
				nextRunAt: '2026-06-08T10:30:00.000Z',
				lastScheduledRunAt: '2026-06-08T10:15:00.000Z',
				lastScheduledRunStatus: 'SUCCESS',
				nextRuns: ['2026-06-08T10:30:00.000Z'],
			}),
		});

		renderWithUi(<ScheduleSection connectionId="c1" />);

		// Cron value is loaded into the input.
		await waitFor(() => {
			expect(screen.getByDisplayValue('*/15 * * * *')).toBeDefined();
		});
		// Status row is rendered with the last scheduled result.
		const status = screen.getByTestId('schedule-status');
		expect(within(status).getByText('SUCCESS')).toBeDefined();
		// A live preview (next runs) is shown for the valid cron.
		expect(screen.getAllByText(/Next runs/i).length).toBeGreaterThan(0);
	});

	it('shows an inline error for an invalid cron and does not save', async () => {
		vi.spyOn(adminApi, 'getSyncSchedule').mockResolvedValue({
			schedule: scheduleDto({
				scheduleEnabled: true,
				scheduleCron: '*/15 * * * *',
				scheduleTimezone: 'UTC',
			}),
		});
		const updateSpy = vi.spyOn(adminApi, 'updateSyncSchedule');

		renderWithUi(<ScheduleSection connectionId="c1" />);
		const cronInput = await screen.findByDisplayValue('*/15 * * * *');
		fireEvent.change(cronInput, { target: { value: '* * * * *' } }); // every minute < 5 min min

		await waitFor(() => {
			// "too frequently" appears only in the inline validation error (not in the hint).
			expect(screen.getByText(/too frequently/i)).toBeDefined();
		});
		fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
		expect(updateSpy).not.toHaveBeenCalled();
	});

	it('saves a valid schedule via updateSyncSchedule', async () => {
		vi.spyOn(adminApi, 'getSyncSchedule').mockResolvedValue({
			schedule: scheduleDto({
				scheduleEnabled: true,
				scheduleCron: '0 * * * *',
				scheduleTimezone: 'UTC',
			}),
		});
		const updateSpy = vi.spyOn(adminApi, 'updateSyncSchedule').mockResolvedValue({
			schedule: scheduleDto({ scheduleEnabled: true, scheduleCron: '0 * * * *' }),
		});

		renderWithUi(<ScheduleSection connectionId="c1" />);
		await screen.findByDisplayValue('0 * * * *');
		fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));

		await waitFor(() => {
			expect(updateSpy).toHaveBeenCalledWith(
				'c1',
				expect.objectContaining({ scheduleEnabled: true, scheduleCron: '0 * * * *' }),
			);
		});
	});
});

describe('HARD-RUNNOW-01 + pause (web)', () => {
	it('Run now triggers a manual sync (triggerIdentitySync) and reloads the schedule', async () => {
		vi.spyOn(adminApi, 'getSyncSchedule').mockResolvedValue({
			schedule: scheduleDto({
				scheduleEnabled: true,
				scheduleCron: '0 * * * *',
				scheduleTimezone: 'UTC',
			}),
		});
		const runSpy = vi
			.spyOn(adminApi, 'triggerIdentitySync')
			.mockResolvedValue({ syncLog: { id: 'log-now' }, connection: {} } as never);

		renderWithUi(<ScheduleSection connectionId="c1" />);
		await screen.findByDisplayValue('0 * * * *');

		fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
		// Confirm the warning dialog.
		const dialog = await screen.findByRole('dialog');
		fireEvent.click(within(dialog).getByRole('button', { name: 'Run now' }));

		await waitFor(() => {
			expect(runSpy).toHaveBeenCalledWith('c1', {});
		});
	});

	it('pausing keeps the schedule and saves schedulePaused = true', async () => {
		vi.spyOn(adminApi, 'getSyncSchedule').mockResolvedValue({
			schedule: scheduleDto({
				scheduleEnabled: true,
				scheduleCron: '0 * * * *',
				scheduleTimezone: 'UTC',
			}),
		});
		const updateSpy = vi.spyOn(adminApi, 'updateSyncSchedule').mockResolvedValue({
			schedule: scheduleDto({ scheduleEnabled: true, schedulePaused: true }),
		});

		renderWithUi(<ScheduleSection connectionId="c1" />);
		await screen.findByDisplayValue('0 * * * *');

		fireEvent.click(screen.getByRole('checkbox', { name: /Pause/i }));
		fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));

		await waitFor(() => {
			expect(updateSpy).toHaveBeenCalledWith(
				'c1',
				expect.objectContaining({ schedulePaused: true }),
			);
		});
	});
});

describe('WEB-SCHED-02: sync history labels manual vs scheduled', () => {
	function mockSyncPage(logs: Array<{ id: string; triggerSource: 'manual' | 'scheduled' }>) {
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
		vi.spyOn(adminApi, 'getSyncSchedule').mockResolvedValue({ schedule: scheduleDto() });
		return vi.spyOn(adminApi, 'listSyncLogs').mockResolvedValue({
			syncLogs: logs.map((l) => ({
				id: l.id,
				apiConnectionId: 'c1',
				startedAt: '2026-06-08T10:00:00.000Z',
				finishedAt: '2026-06-08T10:00:05.000Z',
				durationMs: 5000,
				status: 'SUCCESS' as const,
				usersSynced: 1,
				groupsSynced: 0,
				rolesSynced: 0,
				dryRun: false,
				triggerSource: l.triggerSource,
				errors: null,
			})),
		});
	}

	it('renders manual/scheduled badges and filters by source', async () => {
		const listSpy = mockSyncPage([
			{ id: 'log-m', triggerSource: 'manual' },
			{ id: 'log-s', triggerSource: 'scheduled' },
		]);

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

		// Each log row carries a source badge (also present as filter options, hence scope to list items).
		await waitFor(() => {
			const items = screen.getAllByRole('listitem');
			const labels = items.map((li) => li.textContent ?? '');
			expect(labels.some((txt) => txt.includes('Manual'))).toBe(true);
			expect(labels.some((txt) => txt.includes('Scheduled'))).toBe(true);
		});

		// Changing the source filter re-fetches with the chosen source.
		const sourceSelect = screen.getByLabelText('Source');
		fireEvent.change(sourceSelect, { target: { value: 'scheduled' } });
		await waitFor(() => {
			expect(listSpy).toHaveBeenCalledWith('c1', 20, 'scheduled');
		});
	});
});

describe('HARD-OVERVIEW-01 (web): schedules overview page', () => {
	it('lists scheduled connections with run counts and scheduler state', async () => {
		vi.spyOn(adminApi, 'getSchedulesOverview').mockResolvedValue({
			schedulerEnabled: true,
			manualRunCount: 6,
			scheduledRunCount: 4,
			schedules: [
				{
					connectionId: 'c1',
					connectionName: 'HR',
					scheduleEnabled: true,
					schedulePaused: false,
					scheduleDryRun: false,
					scheduleCron: '*/15 * * * *',
					scheduleTimezone: 'UTC',
					nextRunAt: '2026-06-08T10:30:00.000Z',
					lastScheduledRunAt: '2026-06-08T10:15:00.000Z',
					lastScheduledRunStatus: 'SUCCESS',
					scheduleConsecutiveFailures: 0,
					scheduleAutoPausedAt: null,
					scheduleLastError: null,
				},
			],
		});

		renderWithUi(
			<MemoryRouter>
				<SyncSchedulesPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText('HR')).toBeDefined();
		});
		expect(screen.getByText(/Scheduler enabled/i)).toBeDefined();
		expect(screen.getByText(/Manual runs: 6/i)).toBeDefined();
		expect(screen.getByText(/Scheduled runs: 4/i)).toBeDefined();
	});
});
