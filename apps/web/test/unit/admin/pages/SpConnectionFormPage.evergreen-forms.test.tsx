import { cleanup, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SP_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { SpConnectionFormPage } from '@/admin/pages/SpConnectionFormPage';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('SpConnectionFormPage Evergreen forms', () => {
	it('WEB-EVG-77: renders Active Checkbox', () => {
		renderWithUi(
			<MemoryRouter initialEntries={[`${SP_CONNECTION_ROUTE_PREFIX}/new`]}>
				<Routes>
					<Route path={`${SP_CONNECTION_ROUTE_PREFIX}/new`} element={<SpConnectionFormPage />} />
				</Routes>
			</MemoryRouter>,
		);
		expect(screen.getByRole('checkbox', { name: 'Active' })).toBeDefined();
	});

	it('WEB-EVG-86: Deactivate uses evg-btn--danger', async () => {
		vi.spyOn(adminApi, 'getSpConnection').mockResolvedValue({
			id: 'sp-1',
			name: 'App',
			spEntityId: 'urn:sp:1',
			acsUrl: 'https://sp.example.com/acs',
			nameIdFormat: '',
			attributeMapping: null,
			active: true,
			hasSpCertificate: false,
			wantAssertionsEncrypted: false,
			wantAuthnRequestsSigned: false,
			wantLogoutRequestsSigned: false,
			sloUrl: null,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		});

		renderWithUi(
			<MemoryRouter initialEntries={[`${SP_CONNECTION_ROUTE_PREFIX}/sp-1`]}>
				<Routes>
					<Route path={`${SP_CONNECTION_ROUTE_PREFIX}/:id`} element={<SpConnectionFormPage />} />
				</Routes>
			</MemoryRouter>,
		);

		await waitFor(() => {
			const btn = screen.getByRole('button', { name: /Deactivate & delete/i });
			expect(btn.className).toContain('evg-btn--danger');
		});
	});
});
