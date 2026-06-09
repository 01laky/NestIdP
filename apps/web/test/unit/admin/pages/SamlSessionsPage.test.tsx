import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SAML_SESSIONS_ROUTE_PREFIX, type SamlSsoSessionListResponseDto } from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { SamlSessionsPage } from '@/admin/pages/SamlSessionsPage';

function sessionFixture(): SamlSsoSessionListResponseDto {
	return {
		total: 1,
		items: [
			{
				id: 'sso1',
				userId: 'u1',
				username: 'alice',
				createdAt: '2026-01-01T00:00:00.000Z',
				lastSeenAt: '2026-01-01T00:05:00.000Z',
				expiresAt: '2026-01-01T01:00:00.000Z',
				loginIp: '10.0.0.1',
				userAgent: 'Mozilla/5.0',
				lastSeenIp: '10.0.0.1',
				status: 'active',
				terminatedAt: null,
				terminatedReason: null,
				participations: [
					{
						id: 'p1',
						spConnectionId: 'sp1',
						spName: 'App One',
						spEntityId: 'urn:sp:one',
						sessionIndex: '_si',
						nameId: 'alice@example.com',
						nameIdFormat: 'fmt',
						createdAt: '2026-01-01T00:00:00.000Z',
					},
				],
			},
		],
	};
}

function renderPage() {
	return renderWithUi(
		<MemoryRouter initialEntries={[SAML_SESSIONS_ROUTE_PREFIX]}>
			<Routes>
				<Route path={SAML_SESSIONS_ROUTE_PREFIX} element={<SamlSessionsPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('SamlSessionsPage', () => {
	it('WEB-SESS-01: renders sessions with participations + IP/UA', async () => {
		vi.spyOn(adminApi, 'listSamlSessions').mockResolvedValue(sessionFixture());
		vi.spyOn(adminApi, 'listSpConnections').mockResolvedValue({ items: [] });
		renderPage();
		await waitFor(() => {
			expect(screen.getByText('alice')).toBeDefined();
			expect(screen.getByText('App One')).toBeDefined();
			expect(screen.getByText('10.0.0.1')).toBeDefined();
		});
	});

	it('WEB-SESS-04: back-channel-aware limitation callout is visible', async () => {
		vi.spyOn(adminApi, 'listSamlSessions').mockResolvedValue(sessionFixture());
		vi.spyOn(adminApi, 'listSpConnections').mockResolvedValue({ items: [] });
		renderPage();
		await waitFor(() => {
			expect(screen.getByText(/authoritative at the IdP/i)).toBeDefined();
		});
	});

	it('WEB-SESS-03: terminate action calls API after confirm', async () => {
		vi.spyOn(adminApi, 'listSamlSessions').mockResolvedValue(sessionFixture());
		vi.spyOn(adminApi, 'listSpConnections').mockResolvedValue({ items: [] });
		const terminate = vi
			.spyOn(adminApi, 'terminateSamlSession')
			.mockResolvedValue({ ok: true, id: 'sso1', alreadyTerminated: false });

		renderPage();
		await waitFor(() => expect(screen.getByText('alice')).toBeDefined());

		fireEvent.click(screen.getByRole('button', { name: 'Terminate' }));
		// Confirm dialog → click the confirm button
		await waitFor(() => {
			const confirmButtons = screen.getAllByRole('button', { name: 'Terminate' });
			expect(confirmButtons.length).toBeGreaterThan(1);
		});
		const buttons = screen.getAllByRole('button', { name: 'Terminate' });
		fireEvent.click(buttons[buttons.length - 1]);

		await waitFor(() => {
			expect(terminate).toHaveBeenCalledWith('sso1');
		});
	});

	function backchannelFixture(): SamlSsoSessionListResponseDto {
		const base = sessionFixture();
		base.items[0].backchannelLogouts = [
			{
				spConnectionId: 'sp1',
				spName: 'App One',
				status: 'failed',
				attempts: 2,
				lastError: 'network',
				lastAttemptAt: '2026-01-01T00:05:00.000Z',
				nextRetryAt: '2026-01-01T00:10:00.000Z',
			},
		];
		return base;
	}

	it('WEB-BC-01: renders checkboxes, select-all, bulk + propagation indicator', async () => {
		vi.spyOn(adminApi, 'listSamlSessions').mockResolvedValue(backchannelFixture());
		vi.spyOn(adminApi, 'listSpConnections').mockResolvedValue({ items: [] });
		vi.spyOn(adminApi, 'getBackchannelQueueHealth').mockResolvedValue({
			pending: 1,
			inFlight: 0,
			succeeded: 3,
			partial: 0,
			failed: 2,
			givenUp: 1,
			skipped: 0,
		});
		renderPage();
		await waitFor(() => expect(screen.getByText('alice')).toBeDefined());

		expect(screen.getByLabelText('Select all active')).toBeDefined();
		expect(screen.getAllByRole('checkbox').length).toBeGreaterThanOrEqual(2);
		expect(screen.getByRole('button', { name: 'Terminate selected' })).toBeDefined();
		expect(screen.getByRole('button', { name: 'Terminate all active' })).toBeDefined();
		expect(screen.getByRole('button', { name: 'Process now' })).toBeDefined();
		// per-SP indicator + resend for the failed delivery
		expect(screen.getByText('Failed')).toBeDefined();
		expect(screen.getByRole('button', { name: 'Resend' })).toBeDefined();
	});

	it('WEB-BC-01b: select-all then "Terminate selected" calls the bulk endpoint', async () => {
		vi.spyOn(adminApi, 'listSamlSessions').mockResolvedValue(backchannelFixture());
		vi.spyOn(adminApi, 'listSpConnections').mockResolvedValue({ items: [] });
		vi.spyOn(adminApi, 'getBackchannelQueueHealth').mockResolvedValue({
			pending: 0,
			inFlight: 0,
			succeeded: 0,
			partial: 0,
			failed: 0,
			givenUp: 0,
			skipped: 0,
		});
		const bulk = vi.spyOn(adminApi, 'terminateSamlSessionsBulk').mockResolvedValue({
			ok: true,
			results: [{ id: 'sso1', outcome: 'terminated' }],
			terminatedCount: 1,
		});
		renderPage();
		await waitFor(() => expect(screen.getByText('alice')).toBeDefined());

		fireEvent.click(screen.getByLabelText('Select all active'));
		fireEvent.click(screen.getByRole('button', { name: 'Terminate selected' }));
		// confirm dialog → click its confirm (last button with that name)
		await waitFor(() => {
			expect(screen.getAllByRole('button', { name: 'Terminate selected' }).length).toBeGreaterThan(
				1,
			);
		});
		const confirmButtons = screen.getAllByRole('button', { name: 'Terminate selected' });
		fireEvent.click(confirmButtons[confirmButtons.length - 1]);

		await waitFor(() => expect(bulk).toHaveBeenCalledWith(['sso1']));
	});

	it('WEB-BC-01c: "Resend" on a failed delivery calls the resend endpoint', async () => {
		vi.spyOn(adminApi, 'listSamlSessions').mockResolvedValue(backchannelFixture());
		vi.spyOn(adminApi, 'listSpConnections').mockResolvedValue({ items: [] });
		vi.spyOn(adminApi, 'getBackchannelQueueHealth').mockResolvedValue({
			pending: 0,
			inFlight: 0,
			succeeded: 0,
			partial: 0,
			failed: 1,
			givenUp: 0,
			skipped: 0,
		});
		const resend = vi
			.spyOn(adminApi, 'resendBackchannelLogout')
			.mockResolvedValue({ ok: true, ssoSessionId: 'sso1', spConnectionId: 'sp1' });
		renderPage();
		await waitFor(() => expect(screen.getByText('alice')).toBeDefined());

		fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
		await waitFor(() => expect(resend).toHaveBeenCalledWith('sso1', 'sp1'));
	});
});
