import { readFileSync, readdirSync } from 'node:fs';
import { evergreenDir, webSrc } from '@test/helpers/paths';
import { join } from 'node:path';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
	API_CONNECTION_ROUTE_PREFIX,
	IDENTITY_ROUTE_PREFIX,
	identityGroupEditRoute,
	identityRoleEditRoute,
} from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminApiError } from '@/admin/adminApi';
import * as adminApi from '@/admin/adminApi';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { IdentityGroupDetailPage } from '@/admin/pages/IdentityGroupDetailPage';
import { IdentityGroupFormPage } from '@/admin/pages/IdentityGroupFormPage';
import { IdentityGroupsPage } from '@/admin/pages/IdentityGroupsPage';
import { IdentityRoleDetailPage } from '@/admin/pages/IdentityRoleDetailPage';
import { IdentityRoleFormPage } from '@/admin/pages/IdentityRoleFormPage';
import { IdentityRolesPage } from '@/admin/pages/IdentityRolesPage';
import { IdentityUserDetailPage } from '@/admin/pages/IdentityUserDetailPage';
import { IdentityUsersPage } from '@/admin/pages/IdentityUsersPage';

const adminPagesDir = join(webSrc, 'admin/pages');

const manualUserListItem = {
	id: 'u1',
	username: 'alice',
	email: 'a@example.com',
	displayName: 'Alice',
	externalId: 'manual:user:u1',
	apiConnectionId: 'loc',
	origin: 'manual' as const,
	active: true,
};

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function listIdentityPageFiles(): string[] {
	return readdirSync(adminPagesDir).filter(
		(name) => name.startsWith('Identity') && name.endsWith('.tsx'),
	);
}

describe('Identity UI edge — extended (WEB-IDN-UI-25+)', () => {
	it('WEB-IDN-UI-25: no hand-rolled evg-btn className on Identity pages', () => {
		const hits: string[] = [];
		for (const file of listIdentityPageFiles()) {
			if (file.includes('.test.')) {
				continue;
			}
			const text = readFileSync(join(adminPagesDir, file), 'utf8');
			if (/className=["']evg-btn/.test(text)) {
				hits.push(file);
			}
		}
		expect(hits).toEqual([]);
	});

	it('WEB-IDN-UI-26: identity list pages use evg-inline-form in source', () => {
		// The filter toolbar now lives in the shared IdentityListPage shell (Prompt 38 §A17); the three
		// list pages are thin wrappers that delegate to it.
		const text = readFileSync(
			join(webSrc, 'admin/components/identity/IdentityListPage.tsx'),
			'utf8',
		);
		expect(text).toContain('evg-inline-form');
		expect(text).not.toContain('labelVisuallyHidden');
	});

	it('WEB-IDN-UI-27: roles Origin + Apply refetches list', async () => {
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
		await waitFor(() => expect(listSpy).toHaveBeenCalled());
		listSpy.mockClear();
		fireEvent.change(screen.getByLabelText('Origin'), { target: { value: 'synced' } });
		fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		await waitFor(() => {
			expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ origin: 'synced' }));
		});
	});

	it('WEB-IDN-UI-28: groups filter disables controls while refetching', async () => {
		let resolvePending: (value: { items: []; total: 0 }) => void = () => undefined;
		const pending = new Promise<{ items: []; total: 0 }>((resolve) => {
			resolvePending = resolve;
		});
		vi.spyOn(adminApi, 'listIdentityGroups')
			.mockResolvedValueOnce({ items: [], total: 0 })
			.mockImplementation(() => pending);
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/groups`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/groups`} element={<IdentityGroupsPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => expect(screen.getByLabelText('Origin')).toBeDefined());
		fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		await waitFor(() => {
			expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(
				true,
			);
			expect(
				screen.getByLabelText('Filter groups').closest('form')?.getAttribute('aria-busy'),
			).toBe('true');
		});
		resolvePending({ items: [], total: 0 });
		await waitFor(() => {
			expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(
				false,
			);
		});
	});

	it('WEB-IDN-UI-29: roles filter aria-label on form', () => {
		vi.spyOn(adminApi, 'listIdentityRoles').mockResolvedValue({ items: [], total: 0 });
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/roles`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/roles`} element={<IdentityRolesPage />} />
				</Routes>
			</MemoryRouter>,
		);
		expect(screen.getByLabelText('Filter roles')).toBeDefined();
	});

	it('WEB-IDN-UI-30: groups list table in evg-table-wrap', async () => {
		vi.spyOn(adminApi, 'listIdentityGroups').mockResolvedValue({
			items: [
				{
					id: 'g1',
					name: 'Ops',
					externalId: 'manual:group:g1',
					apiConnectionId: 'loc',
					origin: 'manual',
					memberCount: 2,
				},
			],
			total: 1,
		});
		const { container } = renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/groups`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/groups`} element={<IdentityGroupsPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(container.querySelector('.evg-table-wrap table')).not.toBeNull();
		});
	});

	it('WEB-IDN-UI-31: roles list table in evg-table-wrap', async () => {
		vi.spyOn(adminApi, 'listIdentityRoles').mockResolvedValue({
			items: [
				{
					id: 'r1',
					name: 'Viewer',
					externalId: 'manual:role:r1',
					apiConnectionId: 'loc',
					origin: 'synced',
					memberCount: 0,
				},
			],
			total: 1,
		});
		const { container } = renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/roles`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/roles`} element={<IdentityRolesPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(container.querySelector('.evg-table-wrap tbody tr')).not.toBeNull();
		});
	});

	it('WEB-IDN-UI-32: groups origin select uses evg-field--fixed', () => {
		vi.spyOn(adminApi, 'listIdentityGroups').mockResolvedValue({ items: [], total: 0 });
		const { container } = renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/groups`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/groups`} element={<IdentityGroupsPage />} />
				</Routes>
			</MemoryRouter>,
		);
		expect(container.querySelector('.evg-field--fixed select.evg-select')).not.toBeNull();
	});

	it('WEB-IDN-UI-33: users search and origin combined on Apply', async () => {
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
		await waitFor(() => expect(listSpy).toHaveBeenCalled());
		listSpy.mockClear();
		fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'bob' } });
		fireEvent.change(screen.getByLabelText('Origin'), { target: { value: 'synced' } });
		fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		await waitFor(() => {
			expect(listSpy).toHaveBeenCalledWith(
				expect.objectContaining({ search: 'bob', origin: 'synced' }),
			);
		});
	});

	it('WEB-IDN-UI-34: synced user detail shows API connection ButtonLink', async () => {
		vi.spyOn(adminApi, 'getIdentityUser').mockResolvedValue({
			user: { ...manualUserListItem, origin: 'synced', username: 'synced-user' },
			groups: [],
			roles: [],
			source: {
				kind: 'api_connection',
				label: 'HR API',
				apiConnectionId: 'hr1',
				apiConnectionRoute: `${API_CONNECTION_ROUTE_PREFIX}/hr1`,
			},
		});
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/users/u-sync`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users/:id`} element={<IdentityUserDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => {
			const link = screen.getByRole('link', { name: 'View API connection' });
			expect(link.className).toContain('evg-btn--link');
			expect(link.getAttribute('href')).toContain('/admin/api-connections/');
		});
	});

	it('WEB-IDN-UI-35: synced user detail hides Edit and Delete actions', async () => {
		vi.spyOn(adminApi, 'getIdentityUser').mockResolvedValue({
			user: { ...manualUserListItem, origin: 'synced' },
			groups: [],
			roles: [],
			source: {
				kind: 'api_connection',
				label: 'HR',
				apiConnectionId: 'hr',
				apiConnectionRoute: null,
			},
		});
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/users/u2`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users/:id`} element={<IdentityUserDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => expect(screen.getByText('Synced')).toBeDefined());
		expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
	});

	it('WEB-IDN-UI-36: manual user Back to users uses ButtonLink', async () => {
		vi.spyOn(adminApi, 'getIdentityUser').mockResolvedValue({
			user: manualUserListItem,
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
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/users/u1`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users/:id`} element={<IdentityUserDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole('link', { name: 'Back to users' }).className).toContain(
				'evg-btn--link',
			);
		});
	});

	it('WEB-IDN-UI-37: manual group detail Edit and Back use ButtonLink', async () => {
		vi.spyOn(adminApi, 'getIdentityGroup').mockResolvedValue({
			group: {
				id: 'g1',
				name: 'Ops',
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
		await waitFor(() => {
			expect(screen.getByRole('link', { name: 'Edit' }).getAttribute('href')).toContain(
				identityGroupEditRoute('g1'),
			);
			expect(screen.getByRole('link', { name: 'Back to groups' }).className).toContain(
				'evg-btn--link',
			);
		});
	});

	it('WEB-IDN-UI-38: synced group detail hides Edit', async () => {
		vi.spyOn(adminApi, 'getIdentityGroup').mockResolvedValue({
			group: {
				id: 'g2',
				name: 'SyncedGrp',
				externalId: 'ext:g2',
				apiConnectionId: 'hr',
				origin: 'synced',
			},
			members: [],
			memberCount: 0,
		});
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/groups/g2`]}>
				<Routes>
					<Route
						path={`${IDENTITY_ROUTE_PREFIX}/groups/:id`}
						element={<IdentityGroupDetailPage />}
					/>
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull());
	});

	it('WEB-IDN-UI-39: manual role detail Edit uses ButtonLink', async () => {
		vi.spyOn(adminApi, 'getIdentityRole').mockResolvedValue({
			role: {
				id: 'r1',
				name: 'Admin',
				externalId: 'manual:role:r1',
				apiConnectionId: 'loc',
				origin: 'manual',
			},
			members: [],
			memberCount: 0,
		});
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/roles/r1`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/roles/:id`} element={<IdentityRoleDetailPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole('link', { name: 'Edit' }).getAttribute('href')).toContain(
				identityRoleEditRoute('r1'),
			);
		});
	});

	it('WEB-IDN-UI-40: group form cancel uses ButtonLink to groups list', () => {
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/groups/new`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/groups/new`} element={<IdentityGroupFormPage />} />
				</Routes>
			</MemoryRouter>,
		);
		expect(screen.getByRole('link', { name: 'Cancel' }).getAttribute('href')).toBe(
			`${IDENTITY_ROUTE_PREFIX}/groups`,
		);
	});

	it('WEB-IDN-UI-41: role form cancel uses ButtonLink', () => {
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/roles/new`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/roles/new`} element={<IdentityRoleFormPage />} />
				</Routes>
			</MemoryRouter>,
		);
		expect(screen.getByRole('link', { name: 'Cancel' }).className).toContain('evg-btn--link');
	});

	it('WEB-IDN-UI-42: synced group edit guard View group ButtonLink', async () => {
		vi.spyOn(adminApi, 'getIdentityGroup').mockResolvedValue({
			group: {
				id: 'g3',
				name: 'Synced',
				externalId: 'e3',
				apiConnectionId: 'hr',
				origin: 'synced',
			},
			members: [],
			memberCount: 0,
		});
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/groups/g3/edit`]}>
				<Routes>
					<Route
						path={`${IDENTITY_ROUTE_PREFIX}/groups/:id/edit`}
						element={<IdentityGroupFormPage />}
					/>
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(screen.getByRole('link', { name: 'View group' }).className).toContain('evg-btn--link');
		});
	});

	it('WEB-IDN-UI-43: users empty state Create manual user ButtonLink', async () => {
		vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({ items: [], total: 0 });
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/users`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users`} element={<IdentityUsersPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => {
			const emptyCta = screen
				.getAllByRole('link', { name: 'Create manual user' })
				.find((el) => el.className.includes('evg-btn--primary'));
			expect(emptyCta).toBeDefined();
		});
	});

	it('WEB-IDN-UI-44: CSS --evg-control-height token exists', () => {
		const tokens = readFileSync(join(evergreenDir, 'tokens.css'), 'utf8');
		expect(tokens).toContain('--evg-control-height');
	});

	it('WEB-IDN-UI-47: users list API error still shows filter form with Apply', async () => {
		vi.spyOn(adminApi, 'listIdentityUsers').mockRejectedValue(
			new AdminApiError(500, 'Server error'),
		);
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/users`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users`} element={<IdentityUsersPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => expect(screen.getByText(/Server error/i)).toBeDefined());
		expect(screen.getByRole('button', { name: 'Apply' })).toBeDefined();
		expect(screen.getByLabelText('Search')).toBeDefined();
	});

	it('WEB-IDN-UI-48: section nav links use link variant class', () => {
		vi.spyOn(adminApi, 'listIdentityGroups').mockResolvedValue({ items: [], total: 0 });
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/groups`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/groups`} element={<IdentityGroupsPage />} />
				</Routes>
			</MemoryRouter>,
		);
		const usersLink = screen.getByRole('link', { name: 'Users' });
		expect(usersLink.className).toContain('evg-btn--link');
	});

	it('WEB-IDN-UI-49: users initial load does not set aria-busy on filter form', async () => {
		let resolvePending: (value: { items: []; total: 0 }) => void = () => undefined;
		const pending = new Promise<{ items: []; total: 0 }>((resolve) => {
			resolvePending = resolve;
		});
		vi.spyOn(adminApi, 'listIdentityUsers').mockImplementation(() => pending);
		const { container } = renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/users`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users`} element={<IdentityUsersPage />} />
				</Routes>
			</MemoryRouter>,
		);
		const form = container.querySelector('form.evg-inline-form');
		expect(form?.getAttribute('aria-busy')).not.toBe('true');
		resolvePending({ items: [], total: 0 });
		await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' })).toBeDefined());
	});

	it('WEB-IDN-UI-50: CSS inline form zeroes field margin-bottom', () => {
		const css = readFileSync(join(evergreenDir, 'components.css'), 'utf8');
		expect(css).toMatch(/\.evg-inline-form\s+\.evg-field\s*\{[^}]*margin-bottom:\s*0/s);
	});

	it('WEB-IDN-UI-51: CSS inline form applies min-height to select and btn', () => {
		const css = readFileSync(join(evergreenDir, 'components.css'), 'utf8');
		expect(css).toMatch(
			/\.evg-inline-form\s+\.evg-select[\s\S]*min-height:\s*var\(--evg-control-height\)/,
		);
		expect(css).toMatch(
			/\.evg-inline-form\s+\.evg-btn[\s\S]*min-height:\s*var\(--evg-control-height\)/,
		);
	});

	it('WEB-IDN-UI-52: TextInput fieldClassName prop documented in identity list shell', () => {
		// The search/origin toolbar fields moved into the shared IdentityListPage shell (Prompt 38 §A17).
		const text = readFileSync(
			join(webSrc, 'admin/components/identity/IdentityListPage.tsx'),
			'utf8',
		);
		expect(text).toContain('fieldClassName="evg-field--grow"');
		expect(text).toContain('fieldClassName="evg-field--fixed"');
	});
});
