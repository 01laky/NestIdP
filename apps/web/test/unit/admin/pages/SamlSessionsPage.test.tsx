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

	it('WEB-SESS-04: limitation callout is visible', async () => {
		vi.spyOn(adminApi, 'listSamlSessions').mockResolvedValue(sessionFixture());
		vi.spyOn(adminApi, 'listSpConnections').mockResolvedValue({ items: [] });
		renderPage();
		await waitFor(() => {
			expect(screen.getByText(/does not end the session already established/i)).toBeDefined();
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
});
