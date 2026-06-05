import { cleanup, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
	ADMIN_USERS_ROUTE_PREFIX,
	API_CONNECTION_ROUTE_PREFIX,
	IDENTITY_ROUTE_PREFIX,
} from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { AdminUsersPage } from '@/admin/pages/AdminUsersPage';
import { ApiConnectionFormPage } from '@/admin/pages/ApiConnectionFormPage';
import { IdentityUsersPage } from '@/admin/pages/IdentityUsersPage';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('Admin forms a11y smoke', () => {
	it('WEB-EVG-103: ApiConnectionFormPage fields reachable via getByLabelText', () => {
		renderWithUi(
			<MemoryRouter initialEntries={[`${API_CONNECTION_ROUTE_PREFIX}/new`]}>
				<Routes>
					<Route path={`${API_CONNECTION_ROUTE_PREFIX}/new`} element={<ApiConnectionFormPage />} />
				</Routes>
			</MemoryRouter>,
		);
		expect(screen.getByLabelText(/^Name/i)).toBeDefined();
		expect(screen.getByLabelText(/^Base URL/i)).toBeDefined();
		expect(screen.getByLabelText(/Bearer token/i)).toBeDefined();
	});

	it('WEB-EVG-103b: AdminUsersPage create form labeled fields', async () => {
		vi.spyOn(adminApi, 'listAdminUsers').mockResolvedValue([]);
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
			expect(screen.getByLabelText(/^Username/i)).toBeDefined();
			expect(screen.getByLabelText(/^Confirm password/i)).toBeDefined();
		});
	});

	it('WEB-EVG-103c: IdentityUsersPage search via visible label', () => {
		vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({ items: [], total: 0 });
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/users`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users`} element={<IdentityUsersPage />} />
				</Routes>
			</MemoryRouter>,
		);
		expect(screen.getByLabelText('Search')).toBeDefined();
	});
});
