import { readFileSync } from 'node:fs';
import { evergreenDir } from '@test/helpers/paths';
import { join } from 'node:path';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
	IDENTITY_ROUTE_PREFIX,
	IDENTITY_USER_NEW_ROUTE,
	identityUserEditRoute,
} from '@nestidp/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { renderWithUi } from '@test/helpers/renderWithUi';
import * as ui from '@/ui';
import { IdentityGroupsPage } from '@/admin/pages/IdentityGroupsPage';
import { IdentityRolesPage } from '@/admin/pages/IdentityRolesPage';
import { IdentityUserDetailPage } from '@/admin/pages/IdentityUserDetailPage';
import { IdentityUserFormPage } from '@/admin/pages/IdentityUserFormPage';
import { IdentityUsersPage } from '@/admin/pages/IdentityUsersPage';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function renderUsersList() {
	return renderWithUi(
		<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/users`]}>
			<Routes>
				<Route path={`${IDENTITY_ROUTE_PREFIX}/users`} element={<IdentityUsersPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('Identity list toolbar UI (WEB-IDN-UI)', () => {
	beforeEach(() => {
		vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({ items: [], total: 0 });
	});

	it('WEB-IDN-UI-01: users filter form has evg-inline-form and Apply submit', () => {
		const { container } = renderUsersList();
		const form = container.querySelector('form.evg-inline-form');
		expect(form).not.toBeNull();
		expect(screen.getByRole('button', { name: 'Apply' })).toBeDefined();
	});

	it('WEB-IDN-UI-02: users Search label is visible', () => {
		const { container } = renderUsersList();
		const label = container.querySelector('.evg-field--grow .evg-field__label');
		expect(label?.textContent).toContain('Search');
		expect(label?.className ?? '').not.toContain('evg-sr-only');
	});

	it('WEB-IDN-UI-03: users origin Select label is Origin', () => {
		renderUsersList();
		expect(screen.getByLabelText('Origin')).toBeDefined();
		expect(screen.queryByLabelText('Show')).toBeNull();
	});

	it('WEB-IDN-UI-04: groups filter submit is Apply', () => {
		vi.spyOn(adminApi, 'listIdentityGroups').mockResolvedValue({ items: [], total: 0 });
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/groups`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/groups`} element={<IdentityGroupsPage />} />
				</Routes>
			</MemoryRouter>,
		);
		expect(screen.getByRole('button', { name: 'Apply' }).className).toContain('evg-btn--secondary');
	});

	it('WEB-IDN-UI-05: roles filter submit is Apply', () => {
		vi.spyOn(adminApi, 'listIdentityRoles').mockResolvedValue({ items: [], total: 0 });
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/roles`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/roles`} element={<IdentityRolesPage />} />
				</Routes>
			</MemoryRouter>,
		);
		expect(screen.getByRole('button', { name: 'Apply' }).className).toContain('evg-btn--secondary');
	});

	it('WEB-IDN-UI-06: users header Create uses ButtonLink primary', () => {
		renderUsersList();
		const createLinks = screen.getAllByRole('link', { name: 'Create manual user' });
		expect(createLinks[0]?.className).toContain('evg-btn--primary');
		expect(createLinks[0]?.tagName).toBe('A');
	});

	it('WEB-IDN-UI-07: groups header Create uses ButtonLink primary', () => {
		vi.spyOn(adminApi, 'listIdentityGroups').mockResolvedValue({ items: [], total: 0 });
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/groups`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/groups`} element={<IdentityGroupsPage />} />
				</Routes>
			</MemoryRouter>,
		);
		expect(screen.getByRole('link', { name: 'Create manual group' }).className).toContain(
			'evg-btn--primary',
		);
	});

	it('WEB-IDN-UI-08: roles header Create uses ButtonLink primary', () => {
		vi.spyOn(adminApi, 'listIdentityRoles').mockResolvedValue({ items: [], total: 0 });
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/roles`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/roles`} element={<IdentityRolesPage />} />
				</Routes>
			</MemoryRouter>,
		);
		expect(screen.getByRole('link', { name: 'Create manual role' }).className).toContain(
			'evg-btn--primary',
		);
	});

	it('WEB-IDN-UI-09: inline form uses styled controls only', () => {
		const { container } = renderUsersList();
		const form = container.querySelector('form.evg-inline-form');
		expect(form?.querySelector('button:not(.evg-btn)')).toBeNull();
		expect(form?.querySelector('input:not(.evg-input)')).toBeNull();
		expect(form?.querySelector('select:not(.evg-select)')).toBeNull();
	});

	it('WEB-IDN-UI-10: CSS evg-inline-form align-items flex-end', () => {
		const css = readFileSync(join(evergreenDir, 'components.css'), 'utf8');
		expect(css).toMatch(/\.evg-inline-form\s*\{[^}]*align-items:\s*flex-end/s);
	});

	it('WEB-IDN-UI-11: CSS evg-field--grow min-width 16rem', () => {
		const css = readFileSync(join(evergreenDir, 'components.css'), 'utf8');
		expect(css).toContain('.evg-field--grow');
		expect(css).toMatch(/\.evg-field--grow[^}]*min-width:\s*16rem/s);
	});

	it('WEB-IDN-UI-12: CSS mobile stack at 480px', () => {
		const css = readFileSync(join(evergreenDir, 'components.css'), 'utf8');
		expect(css).toMatch(
			/@media\s*\(max-width:\s*480px\)[\s\S]*\.evg-inline-form[\s\S]*flex-direction:\s*column/s,
		);
	});

	it('WEB-IDN-UI-13: users Origin + Apply refetches list', async () => {
		const listSpy = vi
			.spyOn(adminApi, 'listIdentityUsers')
			.mockResolvedValue({ items: [], total: 0 });
		renderUsersList();
		await waitFor(() => expect(listSpy.mock.calls.length).toBeGreaterThanOrEqual(1));
		listSpy.mockClear();
		fireEvent.change(screen.getByLabelText('Origin'), { target: { value: 'manual' } });
		fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		await waitFor(() => {
			expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ origin: 'manual' }));
		});
	});

	it('WEB-IDN-UI-14: groups Origin + Apply refetches list', async () => {
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
		await waitFor(() => expect(listSpy).toHaveBeenCalled());
		fireEvent.change(screen.getByLabelText('Origin'), { target: { value: 'manual' } });
		fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		await waitFor(() => {
			expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ origin: 'manual' }));
		});
	});

	it('WEB-IDN-UI-15: users Enter in search submits filter', async () => {
		const listSpy = vi
			.spyOn(adminApi, 'listIdentityUsers')
			.mockResolvedValue({ items: [], total: 0 });
		const { container } = renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/users`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users`} element={<IdentityUsersPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => expect(listSpy.mock.calls.length).toBeGreaterThanOrEqual(1));
		listSpy.mockClear();
		const form = container.querySelector('form.evg-inline-form');
		expect(form).not.toBeNull();
		fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'alice' } });
		fireEvent.submit(form!);
		await waitFor(() => {
			expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ search: 'alice' }));
		});
	});

	it('WEB-IDN-UI-16: users filter form role search and aria-label', () => {
		const { container } = renderUsersList();
		const form = container.querySelector('form.evg-inline-form');
		expect(form?.getAttribute('role')).toBe('search');
		expect(form?.getAttribute('aria-label')).toBe('Filter users');
	});

	it('WEB-IDN-UI-17: users filter disables controls while refetching', async () => {
		let resolvePending: (value: { items: []; total: 0 }) => void = () => undefined;
		const pending = new Promise<{ items: []; total: 0 }>((resolve) => {
			resolvePending = resolve;
		});
		vi.spyOn(adminApi, 'listIdentityUsers')
			.mockResolvedValueOnce({ items: [], total: 0 })
			.mockImplementation(() => pending);
		renderUsersList();
		await waitFor(() => {
			expect((screen.getByLabelText('Search') as HTMLInputElement).disabled).toBe(false);
		});
		fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		await waitFor(() => {
			expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(
				true,
			);
			expect((screen.getByLabelText('Search') as HTMLInputElement).disabled).toBe(true);
			expect(screen.getByRole('search').getAttribute('aria-busy')).toBe('true');
		});
		resolvePending({ items: [], total: 0 });
		await waitFor(() => {
			expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(
				false,
			);
		});
	});

	it('WEB-IDN-UI-18: groups page IdentitySectionNav', () => {
		vi.spyOn(adminApi, 'listIdentityGroups').mockResolvedValue({ items: [], total: 0 });
		const { container } = renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/groups`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/groups`} element={<IdentityGroupsPage />} />
				</Routes>
			</MemoryRouter>,
		);
		const nav = container.querySelector('nav.evg-identity-section-nav');
		expect(nav).not.toBeNull();
		expect(screen.getByRole('link', { name: 'Users' })).toBeDefined();
		expect(screen.getByRole('link', { name: 'Roles' })).toBeDefined();
	});

	it('WEB-IDN-UI-19: users page bottom nav to groups and roles', () => {
		const { container } = renderUsersList();
		const nav = container.querySelector('nav.evg-identity-section-nav');
		expect(nav).not.toBeNull();
		expect(screen.getByRole('link', { name: 'Groups' })).toBeDefined();
		expect(screen.getByRole('link', { name: 'Roles' })).toBeDefined();
	});

	it('WEB-IDN-UI-20: manual user detail Edit uses ButtonLink secondary', async () => {
		vi.spyOn(adminApi, 'getIdentityUser').mockResolvedValue({
			user: {
				id: 'u1',
				username: 'alice',
				email: null,
				displayName: null,
				externalId: 'manual:user:u1',
				apiConnectionId: 'loc',
				origin: 'manual',
				active: true,
			},
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
			const edit = screen.getByRole('link', { name: 'Edit' });
			expect(edit.className).toContain('evg-btn--secondary');
			expect(edit.getAttribute('href')).toContain(identityUserEditRoute('u1'));
		});
	});

	it('WEB-IDN-UI-21: user form cancel uses ButtonLink', () => {
		renderWithUi(
			<MemoryRouter initialEntries={[IDENTITY_USER_NEW_ROUTE]}>
				<Routes>
					<Route path={IDENTITY_USER_NEW_ROUTE} element={<IdentityUserFormPage />} />
				</Routes>
			</MemoryRouter>,
		);
		expect(screen.getByRole('link', { name: 'Cancel' }).className).toContain('evg-btn--link');
	});

	it('WEB-IDN-UI-22: users list table in evg-table-wrap', async () => {
		vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({
			items: [
				{
					id: 'u1',
					username: 'alice',
					email: null,
					displayName: 'Alice',
					externalId: 'e1',
					apiConnectionId: 'l',
					origin: 'manual',
					active: true,
				},
			],
			total: 1,
		});
		const { container } = renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/users`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/users`} element={<IdentityUsersPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => {
			expect(container.querySelector('.evg-table-wrap table')).not.toBeNull();
		});
	});

	it('WEB-IDN-UI-23: users callout panel has evg-identity-callout', () => {
		const { container } = renderUsersList();
		expect(container.querySelector('.evg-panel.evg-identity-callout')).not.toBeNull();
	});

	it('WEB-IDN-UI-24: ButtonLink exported from ui barrel', () => {
		expect(ui.ButtonLink).toBeDefined();
	});
});
