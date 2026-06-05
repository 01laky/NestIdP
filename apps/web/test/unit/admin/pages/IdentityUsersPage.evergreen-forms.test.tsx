import { cleanup, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { IDENTITY_ROUTE_PREFIX } from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { IdentityUsersPage } from '@/admin/pages/IdentityUsersPage';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('IdentityUsersPage Evergreen forms', () => {
	it('WEB-EVG-81: search uses evg-input via TextInput', () => {
		vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({ items: [], total: 0 });
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/users`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users`} element={<IdentityUsersPage />} />
				</Routes>
			</MemoryRouter>,
		);
		expect(screen.getByLabelText('Search').className).toContain('evg-input');
	});
});
