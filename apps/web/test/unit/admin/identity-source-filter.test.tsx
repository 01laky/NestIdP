import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { IDENTITY_ROUTE_PREFIX, type IdentitySourcesResponseDto } from '@nestidp/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { IdentityUsersPage } from '@/admin/pages/IdentityUsersPage';
import { IdentityGroupsPage } from '@/admin/pages/IdentityGroupsPage';
import { IdentityRolesPage } from '@/admin/pages/IdentityRolesPage';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function sourcesFixture(): IdentitySourcesResponseDto {
	return {
		sources: [
			{ apiConnectionId: 'api1', label: 'Corp HR', isLocalDirectory: false },
			{ apiConnectionId: 'api2', label: 'Partner LDAP', isLocalDirectory: false },
		],
	};
}

function renderAt(path: string, element: JSX.Element) {
	return renderWithUi(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path={path} element={element} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('Identity Source filter (WEB-MAS-IDN)', () => {
	beforeEach(() => {
		vi.spyOn(adminApi, 'listIdentitySources').mockResolvedValue(sourcesFixture());
	});

	it('WEB-MAS-IDN-01: users page renders Source filter options + Source column label', async () => {
		vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({
			items: [
				{
					id: 'u1',
					username: 'alice',
					email: null,
					displayName: 'Alice',
					externalId: 'e1',
					apiConnectionId: 'api1',
					origin: 'synced',
					active: true,
				},
			],
			total: 1,
		});
		renderAt(`${IDENTITY_ROUTE_PREFIX}/users`, <IdentityUsersPage />);
		await waitFor(() => expect(screen.getByLabelText('Source')).toBeDefined());
		expect(screen.getByRole('option', { name: 'Corp HR' })).toBeDefined();
		expect(screen.getByRole('option', { name: 'Partner LDAP' })).toBeDefined();
		// the row's Source column resolves the apiConnectionId to its label
		await waitFor(() => {
			expect(screen.getAllByText('Corp HR').length).toBeGreaterThanOrEqual(1);
		});
	});

	it('WEB-MAS-IDN-02: users Source + Apply refetches with apiConnectionId', async () => {
		const listSpy = vi
			.spyOn(adminApi, 'listIdentityUsers')
			.mockResolvedValue({ items: [], total: 0 });
		renderAt(`${IDENTITY_ROUTE_PREFIX}/users`, <IdentityUsersPage />);
		await waitFor(() => expect(screen.getByLabelText('Source')).toBeDefined());
		listSpy.mockClear();
		fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'api2' } });
		fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		await waitFor(() =>
			expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ apiConnectionId: 'api2' })),
		);
	});

	it('WEB-MAS-IDN-03: groups Source + Apply refetches with apiConnectionId', async () => {
		const listSpy = vi
			.spyOn(adminApi, 'listIdentityGroups')
			.mockResolvedValue({ items: [], total: 0 });
		renderAt(`${IDENTITY_ROUTE_PREFIX}/groups`, <IdentityGroupsPage />);
		await waitFor(() => expect(screen.getByLabelText('Source')).toBeDefined());
		listSpy.mockClear();
		fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'api1' } });
		fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		await waitFor(() =>
			expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ apiConnectionId: 'api1' })),
		);
	});

	it('WEB-MAS-IDN-04: roles Source + Apply refetches with apiConnectionId', async () => {
		const listSpy = vi
			.spyOn(adminApi, 'listIdentityRoles')
			.mockResolvedValue({ items: [], total: 0 });
		renderAt(`${IDENTITY_ROUTE_PREFIX}/roles`, <IdentityRolesPage />);
		await waitFor(() => expect(screen.getByLabelText('Source')).toBeDefined());
		listSpy.mockClear();
		fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'api2' } });
		fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		await waitFor(() =>
			expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ apiConnectionId: 'api2' })),
		);
	});

	it('WEB-MAS-IDN-05: a failed sources load leaves the page usable (filter empty)', async () => {
		vi.spyOn(adminApi, 'listIdentitySources').mockRejectedValue(new Error('boom'));
		vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({ items: [], total: 0 });
		renderAt(`${IDENTITY_ROUTE_PREFIX}/users`, <IdentityUsersPage />);
		await waitFor(() => expect(screen.getByLabelText('Source')).toBeDefined());
		// only the "All sources" option is present
		expect(screen.getByRole('option', { name: 'All sources' })).toBeDefined();
		expect(screen.queryByRole('option', { name: 'Corp HR' })).toBeNull();
	});
});
