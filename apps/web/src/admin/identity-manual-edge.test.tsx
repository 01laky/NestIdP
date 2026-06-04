import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
	API_CONNECTION_ROUTE_PREFIX,
	IDENTITY_GROUP_NEW_ROUTE,
	IDENTITY_ROLE_NEW_ROUTE,
	IDENTITY_ROUTE_PREFIX,
	IDENTITY_USER_NEW_ROUTE,
	identityGroupEditRoute,
	identityUserDetailRoute,
	identityUserEditRoute,
} from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from './adminApi';
import { IdentityMembershipPicker } from './components/IdentityMembershipPicker';
import { renderWithUi } from '../test/renderWithUi';
import { IdentityGroupDetailPage } from './pages/IdentityGroupDetailPage';
import { IdentityGroupFormPage } from './pages/IdentityGroupFormPage';
import { IdentityGroupsPage } from './pages/IdentityGroupsPage';
import { IdentityRoleFormPage } from './pages/IdentityRoleFormPage';
import { IdentityRolesPage } from './pages/IdentityRolesPage';
import { IdentityUserDetailPage } from './pages/IdentityUserDetailPage';
import { IdentityUserFormPage } from './pages/IdentityUserFormPage';
import { IdentityUsersPage } from './pages/IdentityUsersPage';

const manualUserStub = {
	id: 'u-man',
	username: 'manual-user',
	email: 'm@example.com',
	displayName: 'Manual',
	active: true,
	externalId: 'manual:user:u-man',
	apiConnectionId: 'loc',
	origin: 'manual' as const,
};

function mockMembershipLists() {
	vi.spyOn(adminApi, 'listIdentityGroups').mockResolvedValue({ items: [], total: 0 });
	vi.spyOn(adminApi, 'listIdentityRoles').mockResolvedValue({ items: [], total: 0 });
}

const webSrc = join(dirname(fileURLToPath(import.meta.url)), '..');

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('Identity manual CRUD — web edge', () => {
	it('WEB-IDN-MAN-01: create user submits API and navigates to detail', async () => {
		mockMembershipLists();
		const createSpy = vi.spyOn(adminApi, 'createIdentityUser').mockResolvedValue({
			user: manualUserStub,
			groups: [],
			roles: [],
			source: {
				kind: 'local_directory',
				label: 'Local directory',
				apiConnectionId: 'loc',
				apiConnectionRoute: null,
			},
		});
		renderWithUi(
			<MemoryRouter initialEntries={[IDENTITY_USER_NEW_ROUTE]}>
				<Routes>
					<Route path={IDENTITY_USER_NEW_ROUTE} element={<IdentityUserFormPage />} />
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users/:id`} element={<IdentityUserDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() =>
			expect(screen.getByRole('heading', { name: 'Create manual user' })).toBeDefined(),
		);
		fireEvent.change(screen.getByLabelText(/Username/), { target: { value: 'manual-user' } });
		fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'password12' } });
		fireEvent.change(screen.getByLabelText(/Confirm password/), {
			target: { value: 'password12' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Create user' }));
		await waitFor(() => expect(createSpy).toHaveBeenCalled());
	});

	it('WEB-IDN-MAN-02: edit user omits empty password from PATCH body', async () => {
		mockMembershipLists();
		const updateSpy = vi.spyOn(adminApi, 'updateIdentityUser').mockResolvedValue({
			user: manualUserStub,
			groups: [],
			roles: [],
			source: {
				kind: 'local_directory',
				label: 'Local directory',
				apiConnectionId: 'loc',
				apiConnectionRoute: null,
			},
		});
		vi.spyOn(adminApi, 'getIdentityUser').mockResolvedValue({
			user: manualUserStub,
			groups: [],
			roles: [],
			source: {
				kind: 'local_directory',
				label: 'Local directory',
				apiConnectionId: 'loc',
				apiConnectionRoute: null,
			},
		});
		renderWithUi(
			<MemoryRouter initialEntries={[identityUserEditRoute('u-man')]}>
				<Routes>
					<Route
						path={`${IDENTITY_ROUTE_PREFIX}/users/:id/edit`}
						element={<IdentityUserFormPage />}
					/>
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => expect(screen.getByLabelText(/Username/)).toBeDefined());
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => {
			const body = updateSpy.mock.calls[0]?.[1];
			expect(body?.password).toBeUndefined();
		});
	});

	it('WEB-IDN-MAN-03: synced user edit page shows read-only message', async () => {
		vi.spyOn(adminApi, 'getIdentityUser').mockResolvedValue({
			user: { ...manualUserStub, origin: 'synced', username: 'synced-user' },
			groups: [],
			roles: [],
			source: {
				kind: 'api_connection',
				label: 'HR',
				apiConnectionId: 'c1',
				apiConnectionRoute: `${API_CONNECTION_ROUTE_PREFIX}/c1`,
			},
		});
		renderWithUi(
			<MemoryRouter initialEntries={[identityUserEditRoute('u-sync')]}>
				<Routes>
					<Route
						path={`${IDENTITY_ROUTE_PREFIX}/users/:id/edit`}
						element={<IdentityUserFormPage />}
					/>
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => expect(screen.getByText(/managed by identity sync/)).toBeDefined());
	});

	it('WEB-IDN-MAN-04: manual user detail shows Edit and Delete', async () => {
		vi.spyOn(adminApi, 'getIdentityUser').mockResolvedValue({
			user: manualUserStub,
			groups: [],
			roles: [],
			source: {
				kind: 'local_directory',
				label: 'Local directory',
				apiConnectionId: 'loc',
				apiConnectionRoute: null,
			},
		});
		renderWithUi(
			<MemoryRouter initialEntries={[identityUserDetailRoute('u-man')]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users/:id`} element={<IdentityUserDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole('link', { name: 'Edit' })).toBeDefined();
			expect(screen.getByRole('button', { name: 'Delete' })).toBeDefined();
		});
	});

	it('WEB-IDN-MAN-05: synced user detail hides Edit and Delete', async () => {
		vi.spyOn(adminApi, 'getIdentityUser').mockResolvedValue({
			user: { ...manualUserStub, origin: 'synced', username: 'synced' },
			groups: [],
			roles: [],
			source: {
				kind: 'api_connection',
				label: 'HR',
				apiConnectionId: 'c1',
				apiConnectionRoute: null,
			},
		});
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/users/u-sync`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users/:id`} element={<IdentityUserDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => expect(screen.getByText('Synced')).toBeDefined());
		expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
	});

	it('WEB-IDN-MAN-06: users list renders Manual origin badge', async () => {
		vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({
			items: [manualUserStub],
			total: 1,
		});
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/users`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users`} element={<IdentityUsersPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getAllByText('Manual').length).toBeGreaterThanOrEqual(1);
		});
	});

	it('WEB-IDN-MAN-07: users list origin filter refetches with manual', async () => {
		const listSpy = vi
			.spyOn(adminApi, 'listIdentityUsers')
			.mockResolvedValue({ items: [], total: 0 });
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/users`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users`} element={<IdentityUsersPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => expect(listSpy.mock.calls.length).toBeGreaterThanOrEqual(1));
		listSpy.mockClear();
		fireEvent.change(screen.getByLabelText('Origin'), { target: { value: 'manual' } });
		fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		await waitFor(() => {
			expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ origin: 'manual' }));
		});
	});

	it('WEB-IDN-MAN-08: create group form calls API', async () => {
		const createSpy = vi.spyOn(adminApi, 'createIdentityGroup').mockResolvedValue({
			group: {
				id: 'g1',
				name: 'Ops',
				externalId: 'manual:group:g1',
				apiConnectionId: 'loc',
				origin: 'manual',
				memberCount: 0,
			},
			members: [],
			memberCount: 0,
		});
		renderWithUi(
			<MemoryRouter initialEntries={[IDENTITY_GROUP_NEW_ROUTE]}>
				<Routes>
					<Route path={IDENTITY_GROUP_NEW_ROUTE} element={<IdentityGroupFormPage />} />
				</Routes>
			</MemoryRouter>,
		);
		fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Ops' } });
		fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
		await waitFor(() => expect(createSpy).toHaveBeenCalledWith({ name: 'Ops' }));
	});

	it('WEB-IDN-MAN-09: create role form calls API', async () => {
		const createSpy = vi.spyOn(adminApi, 'createIdentityRole').mockResolvedValue({
			role: {
				id: 'r1',
				name: 'Viewer',
				externalId: 'manual:role:r1',
				apiConnectionId: 'loc',
				origin: 'manual',
				memberCount: 0,
			},
			members: [],
			memberCount: 0,
		});
		renderWithUi(
			<MemoryRouter initialEntries={[IDENTITY_ROLE_NEW_ROUTE]}>
				<Routes>
					<Route path={IDENTITY_ROLE_NEW_ROUTE} element={<IdentityRoleFormPage />} />
				</Routes>
			</MemoryRouter>,
		);
		fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Viewer' } });
		fireEvent.click(screen.getByRole('button', { name: 'Create role' }));
		await waitFor(() => expect(createSpy).toHaveBeenCalledWith({ name: 'Viewer' }));
	});

	it('WEB-IDN-MAN-11: manual group detail shows Edit action', async () => {
		vi.spyOn(adminApi, 'getIdentityGroup').mockResolvedValue({
			group: {
				id: 'g1',
				name: 'ManualGrp',
				externalId: 'manual:group:g1',
				apiConnectionId: 'loc',
				origin: 'manual',
			},
			members: [],
			memberCount: 0,
		});
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/groups/g1`]}>
				<Routes>
					<Route
						path={`${IDENTITY_ROUTE_PREFIX}/groups/:id`}
						element={<IdentityGroupDetailPage />}
					/>
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => expect(screen.getByRole('link', { name: 'Edit' })).toBeDefined());
	});

	it('WEB-IDN-MAN-12: synced group detail shows membership callout', async () => {
		vi.spyOn(adminApi, 'getIdentityGroup').mockResolvedValue({
			group: {
				id: 'g1',
				name: 'SyncGrp',
				externalId: 'ext',
				apiConnectionId: 'c1',
				origin: 'synced',
			},
			members: [],
			memberCount: 0,
		});
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/groups/g1`]}>
				<Routes>
					<Route
						path={`${IDENTITY_ROUTE_PREFIX}/groups/:id`}
						element={<IdentityGroupDetailPage />}
					/>
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => expect(screen.getByText(/controlled by identity sync/)).toBeDefined());
	});

	it('WEB-IDN-MAN-13: delete user skipped when confirm cancelled', async () => {
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
		const deleteSpy = vi.spyOn(adminApi, 'deleteIdentityUser');
		vi.spyOn(adminApi, 'getIdentityUser').mockResolvedValue({
			user: manualUserStub,
			groups: [],
			roles: [],
			source: {
				kind: 'local_directory',
				label: 'Local directory',
				apiConnectionId: 'loc',
				apiConnectionRoute: null,
			},
		});
		renderWithUi(
			<MemoryRouter initialEntries={[identityUserDetailRoute('u-man')]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users/:id`} element={<IdentityUserDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => screen.getByRole('button', { name: 'Delete' }));
		fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		expect(confirmSpy).toHaveBeenCalled();
		expect(deleteSpy).not.toHaveBeenCalled();
	});

	it('WEB-IDN-MAN-14: delete user calls API when confirm accepted', async () => {
		vi.spyOn(window, 'confirm').mockReturnValue(true);
		const deleteSpy = vi.spyOn(adminApi, 'deleteIdentityUser').mockResolvedValue(undefined);
		vi.spyOn(adminApi, 'getIdentityUser').mockResolvedValue({
			user: manualUserStub,
			groups: [],
			roles: [],
			source: {
				kind: 'local_directory',
				label: 'Local directory',
				apiConnectionId: 'loc',
				apiConnectionRoute: null,
			},
		});
		renderWithUi(
			<MemoryRouter initialEntries={[identityUserDetailRoute('u-man')]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users/:id`} element={<IdentityUserDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => screen.getByRole('button', { name: 'Delete' }));
		fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('u-man'));
	});

	it('WEB-IDN-MAN-15: user form sets aria-busy while saving', async () => {
		mockMembershipLists();
		let resolveCreate!: (v: Awaited<ReturnType<typeof adminApi.createIdentityUser>>) => void;
		vi.spyOn(adminApi, 'createIdentityUser').mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveCreate = resolve;
				}),
		);
		renderWithUi(
			<MemoryRouter initialEntries={[IDENTITY_USER_NEW_ROUTE]}>
				<Routes>
					<Route path={IDENTITY_USER_NEW_ROUTE} element={<IdentityUserFormPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => screen.getByLabelText(/Username/));
		fireEvent.change(screen.getByLabelText(/Username/), { target: { value: 'busy-user' } });
		fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'password12' } });
		fireEvent.change(screen.getByLabelText(/Confirm password/), {
			target: { value: 'password12' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Create user' }));
		await waitFor(() => {
			const form = document.querySelector('form.evg-stack');
			expect(form?.getAttribute('aria-busy')).toBe('true');
		});
		resolveCreate({
			user: { ...manualUserStub, username: 'busy-user' },
			groups: [],
			roles: [],
			source: {
				kind: 'local_directory',
				label: 'Local directory',
				apiConnectionId: 'loc',
				apiConnectionRoute: null,
			},
		});
	});

	it('WEB-IDN-MAN-16: manual user detail shows local source without API link', async () => {
		vi.spyOn(adminApi, 'getIdentityUser').mockResolvedValue({
			user: manualUserStub,
			groups: [],
			roles: [],
			source: {
				kind: 'local_directory',
				label: 'Local directory',
				apiConnectionId: 'loc',
				apiConnectionRoute: null,
			},
		});
		renderWithUi(
			<MemoryRouter initialEntries={[identityUserDetailRoute('u-man')]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users/:id`} element={<IdentityUserDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => expect(screen.getByText(/Local directory \(manual\)/)).toBeDefined());
		expect(screen.queryByRole('link', { name: 'View API connection' })).toBeNull();
	});

	it('WEB-IDN-MAN-17: roles list origin filter refetches', async () => {
		const listSpy = vi
			.spyOn(adminApi, 'listIdentityRoles')
			.mockResolvedValue({ items: [], total: 0 });
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/roles`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/roles`} element={<IdentityRolesPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => expect(listSpy.mock.calls.length).toBeGreaterThanOrEqual(1));
		listSpy.mockClear();
		fireEvent.change(screen.getByLabelText('Origin'), { target: { value: 'synced' } });
		fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		await waitFor(() => {
			expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ origin: 'synced' }));
		});
	});

	it('WEB-IDN-MAN-18: users list links Create manual user to new route', async () => {
		vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({ items: [], total: 0 });
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/users`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users`} element={<IdentityUsersPage />} />
				</Routes>
			</MemoryRouter>,
		);
		const links = screen.getAllByRole('link', { name: 'Create manual user' });
		expect(links.some((link) => link.getAttribute('href') === IDENTITY_USER_NEW_ROUTE)).toBe(true);
	});

	it('WEB-IDN-MAN-19: synced group edit page is read-only', async () => {
		vi.spyOn(adminApi, 'getIdentityGroup').mockResolvedValue({
			group: {
				id: 'g1',
				name: 'SyncGrp',
				externalId: 'ext',
				apiConnectionId: 'c1',
				origin: 'synced',
			},
			members: [],
			memberCount: 0,
		});
		renderWithUi(
			<MemoryRouter initialEntries={[identityGroupEditRoute('g1')]}>
				<Routes>
					<Route
						path={`${IDENTITY_ROUTE_PREFIX}/groups/:id/edit`}
						element={<IdentityGroupFormPage />}
					/>
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => expect(screen.getByText(/managed by identity sync/)).toBeDefined());
	});

	it('WEB-IDN-MAN-23: create user blocks password mismatch before API', async () => {
		const createSpy = vi.spyOn(adminApi, 'createIdentityUser');
		vi.spyOn(adminApi, 'listIdentityGroups').mockResolvedValue({ items: [], total: 0 });
		vi.spyOn(adminApi, 'listIdentityRoles').mockResolvedValue({ items: [], total: 0 });
		renderWithUi(
			<MemoryRouter initialEntries={[IDENTITY_USER_NEW_ROUTE]}>
				<Routes>
					<Route path={IDENTITY_USER_NEW_ROUTE} element={<IdentityUserFormPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() =>
			expect(screen.getByRole('heading', { name: 'Create manual user' })).toBeDefined(),
		);
		fireEvent.change(screen.getByLabelText(/Username/), { target: { value: 'newuser' } });
		fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'password12' } });
		fireEvent.change(screen.getByLabelText(/Confirm password/), {
			target: { value: 'password99' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Create user' }));
		expect(screen.getByText('Passwords do not match')).toBeDefined();
		expect(createSpy).not.toHaveBeenCalled();
	});

	it('WEB-IDN-MAN-24: synced user detail shows API connection link', async () => {
		vi.spyOn(adminApi, 'getIdentityUser').mockResolvedValue({
			user: {
				id: 'u1',
				username: 'synced',
				email: null,
				displayName: null,
				active: true,
				externalId: 'ext-1',
				apiConnectionId: 'c1',
				origin: 'synced',
			},
			groups: [],
			roles: [],
			source: {
				kind: 'api_connection',
				label: 'HR API',
				apiConnectionId: 'c1',
				apiConnectionRoute: `${API_CONNECTION_ROUTE_PREFIX}/c1`,
			},
		});
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/users/u1`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users/:id`} element={<IdentityUserDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => {
			const link = screen.getByRole('link', { name: 'View API connection' });
			expect(link.getAttribute('href')).toBe(`${API_CONNECTION_ROUTE_PREFIX}/c1`);
		});
	});

	it('WEB-IDN-MAN-27: recent audit panel renders rows', async () => {
		vi.spyOn(adminApi, 'getIdentityUser').mockResolvedValue({
			user: {
				id: 'u1',
				username: 'manual',
				email: null,
				displayName: null,
				active: true,
				externalId: 'manual:user:u1',
				apiConnectionId: 'loc',
				origin: 'manual',
			},
			groups: [],
			roles: [],
			source: {
				kind: 'local_directory',
				label: 'Local directory',
				apiConnectionId: 'loc',
				apiConnectionRoute: null,
			},
			recentAudit: [
				{
					id: 'a1',
					event: 'identity.user.created',
					createdAt: '2026-01-01T00:00:00.000Z',
					actorLabel: 'admin',
				},
			],
		});
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/users/u1`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users/:id`} element={<IdentityUserDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByText('Recent changes')).toBeDefined();
			expect(screen.getByText(/identity\.user\.created/)).toBeDefined();
		});
	});

	it('WEB-IDN-MAN-28: users list callout visible', async () => {
		vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({ items: [], total: 0 });
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/users`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users`} element={<IdentityUsersPage />} />
				</Routes>
			</MemoryRouter>,
		);
		expect(screen.getByText(/Two sources of users/)).toBeDefined();
	});

	it('WEB-IDN-MAN-20: groups list links to detail', async () => {
		vi.spyOn(adminApi, 'listIdentityGroups').mockResolvedValue({
			items: [
				{
					id: 'g1',
					name: 'Admins',
					externalId: 'manual:group:g1',
					apiConnectionId: 'loc',
					origin: 'manual',
					memberCount: 2,
				},
			],
			total: 1,
		});
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/groups`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/groups`} element={<IdentityGroupsPage />} />
					<Route
						path={`${IDENTITY_ROUTE_PREFIX}/groups/:id`}
						element={<IdentityGroupDetailPage />}
					/>
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole('link', { name: 'Admins' }).getAttribute('href')).toBe(
				`${IDENTITY_ROUTE_PREFIX}/groups/g1`,
			);
		});
	});

	it('WEB-IDN-MAN-21: synced group detail hides Edit', async () => {
		vi.spyOn(adminApi, 'getIdentityGroup').mockResolvedValue({
			group: {
				id: 'g1',
				name: 'SyncedGrp',
				externalId: 'ext-g',
				apiConnectionId: 'c1',
				origin: 'synced',
			},
			members: [],
			memberCount: 0,
		});
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/groups/g1`]}>
				<Routes>
					<Route
						path={`${IDENTITY_ROUTE_PREFIX}/groups/:id`}
						element={<IdentityGroupDetailPage />}
					/>
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole('heading', { level: 2, name: 'SyncedGrp' })).toBeDefined();
		});
		expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
	});

	it('WEB-IDN-MAN-22: groups origin filter refetches', async () => {
		const listSpy = vi
			.spyOn(adminApi, 'listIdentityGroups')
			.mockResolvedValue({ items: [], total: 0 });
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/groups`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/groups`} element={<IdentityGroupsPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => expect(listSpy.mock.calls.length).toBeGreaterThanOrEqual(1));
		listSpy.mockClear();
		const select = screen.getByLabelText('Origin');
		fireEvent.change(select, { target: { value: 'manual' } });
		fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		await waitFor(() => {
			expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ origin: 'manual' }));
		});
	});

	it('WEB-IDN-MAN-25: membership picker filter reduces visible checkboxes', async () => {
		vi.spyOn(adminApi, 'listIdentityGroups').mockResolvedValue({
			items: [
				{ id: 'g1', name: 'Alpha', externalId: 'e1', apiConnectionId: 'l', origin: 'manual' },
				{ id: 'g2', name: 'Beta', externalId: 'e2', apiConnectionId: 'l', origin: 'synced' },
			],
			total: 2,
		});
		vi.spyOn(adminApi, 'listIdentityRoles').mockResolvedValue({ items: [], total: 0 });
		renderWithUi(
			<IdentityMembershipPicker
				groupIds={[]}
				roleIds={[]}
				onGroupIdsChange={() => undefined}
				onRoleIdsChange={() => undefined}
			/>,
		);
		await waitFor(() => expect(screen.getByLabelText('Alpha (Manual)')).toBeDefined());
		const groupsFieldset = screen.getByRole('group', { name: 'Groups' });
		const filter = within(groupsFieldset).getByPlaceholderText('Filter by name…');
		fireEvent.change(filter, { target: { value: 'alpha' } });
		expect(screen.getByLabelText('Alpha (Manual)')).toBeDefined();
		expect(screen.queryByLabelText('Beta (Synced)')).toBeNull();
	});

	it('WEB-IDN-MAN-26: membership picker caps selection at 100', async () => {
		const items = Array.from({ length: 101 }, (_, i) => ({
			id: `g${i}`,
			name: `G${i}`,
			externalId: `e${i}`,
			apiConnectionId: 'l',
			origin: 'manual' as const,
		}));
		vi.spyOn(adminApi, 'listIdentityGroups').mockResolvedValue({ items, total: 101 });
		vi.spyOn(adminApi, 'listIdentityRoles').mockResolvedValue({ items: [], total: 0 });
		renderWithUi(
			<IdentityMembershipPicker
				groupIds={items.slice(0, 100).map((g) => g.id)}
				roleIds={[]}
				onGroupIdsChange={() => undefined}
				onRoleIdsChange={() => undefined}
			/>,
		);
		await waitFor(() => expect(screen.getByText(/Maximum 100 groups/)).toBeDefined());
		const unchecked = screen.getByLabelText('G100 (Manual)');
		expect((unchecked as HTMLInputElement).disabled).toBe(true);
	});

	const identityFormFiles = [
		'IdentityUserFormPage.tsx',
		'IdentityGroupFormPage.tsx',
		'IdentityRoleFormPage.tsx',
		'IdentityGroupDetailPage.tsx',
		'IdentityRoleDetailPage.tsx',
	];

	it('WEB-EVG-169: identity form pages import from ui barrel', () => {
		const missing: string[] = [];
		for (const file of identityFormFiles) {
			const text = readFileSync(join(webSrc, 'admin/pages', file), 'utf8');
			if (!/from ['"]\.\.\/\.\.\/ui['"]/.test(text)) {
				missing.push(file);
			}
		}
		const picker = readFileSync(
			join(webSrc, 'admin/components/IdentityMembershipPicker.tsx'),
			'utf8',
		);
		if (!/from ['"]\.\.\/\.\.\/ui['"]/.test(picker)) {
			missing.push('IdentityMembershipPicker.tsx');
		}
		expect(missing).toEqual([]);
	});

	it('WEB-EVG-170: identity form pages do not hand-apply evg-input', () => {
		const hits: string[] = [];
		for (const file of [...identityFormFiles, 'IdentityMembershipPicker.tsx']) {
			const base = file.includes('Picker') ? 'admin/components' : 'admin/pages';
			const text = readFileSync(join(webSrc, base, file), 'utf8');
			if (/className="evg-input"/.test(text)) {
				hits.push(file);
			}
		}
		expect(hits).toEqual([]);
	});

	it('WEB-EVG-171: identity manual pages use Panel on form screens', () => {
		for (const file of [
			'IdentityUserFormPage.tsx',
			'IdentityGroupFormPage.tsx',
			'IdentityRoleFormPage.tsx',
		]) {
			const text = readFileSync(join(webSrc, 'admin/pages', file), 'utf8');
			expect(text).toContain('Panel');
		}
	});
});
