import { cleanup, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ADMIN_USERS_ROUTE_PREFIX } from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { AdminUsersPage } from '@/admin/pages/AdminUsersPage';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('AdminUsersPage Evergreen forms', () => {
	it('WEB-EVG-79: create form uses password TextInput', async () => {
		vi.spyOn(adminApi, 'listAdminUsers').mockResolvedValue([
			{
				id: '1',
				username: 'admin',
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
		]);
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: '1', username: 'admin' },
			csrfToken: 't',
		});

		renderWithUi(
			<MemoryRouter initialEntries={[ADMIN_USERS_ROUTE_PREFIX]}>
				<Routes>
					<Route path={ADMIN_USERS_ROUTE_PREFIX} element={<AdminUsersPage />} />
				</Routes>
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByLabelText(/^Password/i).getAttribute('type')).toBe('password');
		});
	});

	it('WEB-EVG-105: table Delete is Button size sm danger', async () => {
		vi.spyOn(adminApi, 'listAdminUsers').mockResolvedValue([
			{
				id: '1',
				username: 'admin',
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
			{
				id: '2',
				username: 'other',
				createdAt: '2026-01-02T00:00:00.000Z',
				updatedAt: '2026-01-02T00:00:00.000Z',
			},
		]);
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: '1', username: 'admin' },
			csrfToken: 't',
		});

		renderWithUi(
			<MemoryRouter initialEntries={[ADMIN_USERS_ROUTE_PREFIX]}>
				<Routes>
					<Route path={ADMIN_USERS_ROUTE_PREFIX} element={<AdminUsersPage />} />
				</Routes>
			</MemoryRouter>,
		);

		await waitFor(() => {
			const btn = screen.getByRole('button', { name: 'Delete' });
			expect(btn.className).toContain('evg-btn--danger');
			expect(btn.className).toContain('evg-btn--sm');
		});
	});
});
