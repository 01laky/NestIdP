import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { IDENTITY_LIST_PAGE_SIZE, IDENTITY_ROUTE_PREFIX } from '@nestidp/shared';
import type { IdentityUserListItemDto } from '@nestidp/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { AdminApiError } from '@/admin/adminApi';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { useIdentityListQuery } from '@/admin/hooks/useIdentityListQuery';
import { IdentityGroupsPage } from '@/admin/pages/IdentityGroupsPage';
import { IdentityRolesPage } from '@/admin/pages/IdentityRolesPage';
import { IdentityUsersPage } from '@/admin/pages/IdentityUsersPage';
import { webSrc } from '@test/helpers/paths';

const pagesDir = join(webSrc, 'admin/pages');

function mockUser(index: number): IdentityUserListItemDto {
	return {
		id: `user-${index}`,
		username: `user${String(index).padStart(3, '0')}`,
		email: `user${index}@example.com`,
		displayName: `User ${index}`,
		active: true,
		externalId: `ext-${index}`,
		apiConnectionId: 'conn-1',
		origin: 'synced',
	};
}

function pageUsers(start: number, count: number): IdentityUserListItemDto[] {
	return Array.from({ length: count }, (_, i) => mockUser(start + i));
}

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

describe('Identity list pagination (WEB-IDN-TBL)', () => {
	beforeEach(() => {
		vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({ items: [], total: 0 });
	});

	it('WEB-IDN-TBL-01: users initial fetch uses limit 10', async () => {
		const listSpy = vi
			.spyOn(adminApi, 'listIdentityUsers')
			.mockResolvedValue({ items: [], total: 0 });
		renderUsersList();
		await waitFor(() => expect(listSpy).toHaveBeenCalled());
		expect(listSpy.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ limit: 10 }));
	});

	it('WEB-IDN-TBL-02: users Next requests offset 10', async () => {
		const listSpy = vi
			.spyOn(adminApi, 'listIdentityUsers')
			.mockResolvedValueOnce({ items: pageUsers(0, 10), total: 11 })
			.mockResolvedValueOnce({ items: [mockUser(10)], total: 11 });
		renderUsersList();
		await waitFor(() => expect(screen.getByText('user000')).toBeDefined());
		listSpy.mockClear();
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		await waitFor(() => {
			expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 10 }));
		});
		await waitFor(() => expect(screen.getByText('user010')).toBeDefined());
	});

	it('WEB-IDN-TBL-03: users Apply filter resets to first page', async () => {
		const listSpy = vi
			.spyOn(adminApi, 'listIdentityUsers')
			.mockResolvedValue({ items: pageUsers(0, 10), total: 25 });
		renderUsersList();
		await waitFor(() => expect(listSpy.mock.calls.length).toBeGreaterThanOrEqual(1));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		await waitFor(() =>
			expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ offset: 10 })),
		);
		listSpy.mockClear();
		fireEvent.change(screen.getByLabelText('Origin'), { target: { value: 'manual' } });
		fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		await waitFor(() => {
			expect(listSpy).toHaveBeenCalledWith(
				expect.objectContaining({ limit: 10, origin: 'manual', offset: 0 }),
			);
		});
	});

	it('WEB-IDN-TBL-04: groups Next uses limit 10 and offset 10', async () => {
		const listSpy = vi
			.spyOn(adminApi, 'listIdentityGroups')
			.mockResolvedValueOnce({
				items: Array.from({ length: 10 }, (_, i) => ({
					id: `g${i}`,
					name: `Group ${i}`,
					externalId: `eg${i}`,
					apiConnectionId: 'c1',
					origin: 'manual' as const,
					memberCount: 0,
				})),
				total: 15,
			})
			.mockResolvedValueOnce({
				items: [
					{
						id: 'g10',
						name: 'Group 10',
						externalId: 'eg10',
						apiConnectionId: 'c1',
						origin: 'manual' as const,
						memberCount: 0,
					},
				],
				total: 15,
			});
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/groups`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/groups`} element={<IdentityGroupsPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => expect(screen.getByText('Group 0')).toBeDefined());
		listSpy.mockClear();
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		await waitFor(() => {
			expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 10 }));
		});
	});

	it('WEB-IDN-TBL-05: roles Previous disabled on first page', async () => {
		vi.spyOn(adminApi, 'listIdentityRoles').mockResolvedValue({
			items: [
				{
					id: 'r1',
					name: 'admin',
					externalId: 'er1',
					apiConnectionId: 'c1',
					origin: 'manual' as const,
					memberCount: 1,
				},
			],
			total: 1,
		});
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/roles`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/roles`} element={<IdentityRolesPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => expect(screen.getByText('admin')).toBeDefined());
		const prev = screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement;
		expect(prev.disabled).toBe(true);
	});

	it('WEB-IDN-TBL-06: pagination nav has accessible name', async () => {
		vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({
			items: pageUsers(0, 3),
			total: 3,
		});
		renderUsersList();
		await waitFor(() =>
			expect(screen.getByRole('navigation', { name: 'Table pagination' })).toBeDefined(),
		);
	});

	it('WEB-IDN-TBL-07: list pages lazy-load IdentityListTable chunk', () => {
		const lazyHelper = readFileSync(
			join(webSrc, 'admin/components/identity/identityListTableLazy.ts'),
			'utf8',
		);
		expect(lazyHelper).toContain("import('./IdentityListTable')");
		for (const file of [
			'IdentityUsersPage.tsx',
			'IdentityGroupsPage.tsx',
			'IdentityRolesPage.tsx',
		]) {
			const src = readFileSync(join(pagesDir, file), 'utf8');
			expect(src).toContain('createLazyIdentityListTable');
			expect(src).toContain('Suspense');
		}
	});

	it('WEB-IDN-TBL-08: stale fetch response is ignored', async () => {
		let resolveSlow: (value: { items: IdentityUserListItemDto[]; total: number }) => void = () =>
			undefined;
		const slow = new Promise<{ items: IdentityUserListItemDto[]; total: number }>((resolve) => {
			resolveSlow = resolve;
		});
		const fetchPage = vi
			.fn()
			.mockImplementationOnce(() => slow)
			.mockImplementationOnce(() => Promise.resolve({ items: [mockUser(99)], total: 1 }));

		const { result } = renderHook(() =>
			useIdentityListQuery<IdentityUserListItemDto>({
				fetchPage,
				mapError: (err) => String(err),
			}),
		);

		await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1));

		act(() => {
			result.current.applyFilters({ origin: 'synced' });
		});

		await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(result.current.items[0]?.username).toBe('user099'));

		act(() => {
			resolveSlow({ items: [mockUser(0)], total: 1 });
		});

		await new Promise((r) => setTimeout(r, 20));
		expect(result.current.items[0]?.username).toBe('user099');
	});

	it('WEB-IDN-TBL-09: fetch error on page 2 keeps rows and shows banner', async () => {
		vi.spyOn(adminApi, 'listIdentityUsers')
			.mockResolvedValueOnce({ items: pageUsers(0, 10), total: 25 })
			.mockResolvedValueOnce({ items: pageUsers(10, 10), total: 25 })
			.mockRejectedValueOnce(new AdminApiError(500, 'Server error'));
		renderUsersList();
		await waitFor(() => expect(screen.getByText('user000')).toBeDefined());
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		await waitFor(() => expect(screen.getByText('user010')).toBeDefined());
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
		expect(screen.getByText('user010')).toBeDefined();
	});

	it('WEB-IDN-TBL-10: page index clamps when total shrinks', async () => {
		const fetchPage = vi.fn(
			async ({
				offset,
			}: {
				offset: number;
				limit: number;
				filters: Record<string, string | undefined>;
			}) => {
				if (offset === 0) {
					return { items: pageUsers(0, 10), total: 45 };
				}
				if (offset === 30) {
					return { items: pageUsers(30, 10), total: 15 };
				}
				if (offset === 10) {
					return { items: pageUsers(10, 5), total: 15 };
				}
				throw new Error(`unexpected offset ${offset}`);
			},
		);

		const { result } = renderHook(() =>
			useIdentityListQuery<IdentityUserListItemDto>({
				fetchPage,
				mapError: (err) => String(err),
			}),
		);

		await waitFor(() => expect(result.current.items[0]?.username).toBe('user000'));

		act(() => {
			result.current.goToPage(3);
		});

		await waitFor(() => expect(result.current.pageIndex).toBe(1));
		await waitFor(() => expect(result.current.items[0]?.username).toBe('user010'));
		expect(fetchPage).toHaveBeenCalledWith(
			expect.objectContaining({ offset: 10, limit: IDENTITY_LIST_PAGE_SIZE }),
		);
	});

	it('WEB-IDN-TBL-11: groups empty total shows EmptyState without table', async () => {
		vi.spyOn(adminApi, 'listIdentityGroups').mockResolvedValue({ items: [], total: 0 });
		const { container } = renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/groups`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/groups`} element={<IdentityGroupsPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => expect(screen.getByText('No groups')).toBeDefined());
		expect(container.querySelector('table.evg-table')).toBeNull();
	});

	function paginationMeta() {
		return document.querySelector('.evg-table-pagination__meta') as HTMLElement;
	}

	it('WEB-IDN-TBL-14: Next disabled on last page of three', async () => {
		vi.spyOn(adminApi, 'listIdentityUsers')
			.mockResolvedValueOnce({ items: pageUsers(0, 10), total: 25 })
			.mockResolvedValueOnce({ items: pageUsers(10, 10), total: 25 })
			.mockResolvedValueOnce({ items: pageUsers(20, 5), total: 25 });
		renderUsersList();
		await waitFor(() =>
			expect(screen.getByRole('navigation', { name: 'Table pagination' })).toBeDefined(),
		);
		await waitFor(() => expect(screen.getByText('user000')).toBeDefined());
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		await waitFor(() => expect(screen.getByText('user010')).toBeDefined());
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		await waitFor(() => expect(screen.getByText('user020')).toBeDefined());
		expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
		expect(paginationMeta().textContent).toContain('21–25 of 25');
	});

	it('WEB-IDN-TBL-15: Previous returns to first page', async () => {
		vi.spyOn(adminApi, 'listIdentityUsers')
			.mockResolvedValueOnce({ items: pageUsers(0, 10), total: 25 })
			.mockResolvedValueOnce({ items: pageUsers(10, 10), total: 25 })
			.mockResolvedValueOnce({ items: pageUsers(0, 10), total: 25 });
		renderUsersList();
		await waitFor(() =>
			expect(screen.getByRole('navigation', { name: 'Table pagination' })).toBeDefined(),
		);
		await waitFor(() => expect(screen.getByText('user000')).toBeDefined());
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		await waitFor(() => expect(screen.getByText('user010')).toBeDefined());
		fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
		await waitFor(() => expect(screen.getByText('user000')).toBeDefined());
		expect(paginationMeta().textContent).toContain('1–10 of 25');
	});

	it('WEB-IDN-TBL-16: single-page list disables both pagination buttons', async () => {
		vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({
			items: pageUsers(0, 5),
			total: 5,
		});
		renderUsersList();
		await waitFor(() => expect(screen.getByText('user000')).toBeDefined());
		expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(
			true,
		);
		expect(screen.getByText('Page 1 of 1')).toBeDefined();
	});

	it('WEB-IDN-TBL-17: users total zero shows EmptyState and hides pagination', async () => {
		vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({ items: [], total: 0 });
		const { container } = renderUsersList();
		await waitFor(() => expect(screen.getByText('No users')).toBeDefined());
		expect(container.querySelector('.evg-table-pagination')).toBeNull();
	});

	it('WEB-IDN-TBL-18: roles total zero shows roles EmptyState', async () => {
		vi.spyOn(adminApi, 'listIdentityRoles').mockResolvedValue({ items: [], total: 0 });
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/roles`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/roles`} element={<IdentityRolesPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => expect(screen.getByText('No roles')).toBeDefined());
	});

	it('WEB-IDN-TBL-19: search Apply sends search with limit 10', async () => {
		const listSpy = vi
			.spyOn(adminApi, 'listIdentityUsers')
			.mockResolvedValue({ items: [], total: 0 });
		renderUsersList();
		await waitFor(() => expect(listSpy.mock.calls.length).toBeGreaterThanOrEqual(1));
		listSpy.mockClear();
		fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'alice' } });
		fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		await waitFor(() => {
			expect(listSpy).toHaveBeenCalledWith(
				expect.objectContaining({ search: 'alice', limit: 10, offset: 0 }),
			);
		});
	});

	it('WEB-IDN-TBL-20: initial mount does not set aria-busy on filter form', async () => {
		let resolve!: (v: { items: IdentityUserListItemDto[]; total: number }) => void;
		const pending = new Promise<{ items: IdentityUserListItemDto[]; total: number }>((res) => {
			resolve = res;
		});
		vi.spyOn(adminApi, 'listIdentityUsers').mockImplementation(() => pending);
		const { container } = renderUsersList();
		const form = container.querySelector('form.evg-inline-form');
		expect(form?.getAttribute('aria-busy')).not.toBe('true');
		act(() => {
			resolve({ items: [], total: 0 });
		});
		await waitFor(() => expect(screen.getByText('No users')).toBeDefined());
	});

	it('WEB-IDN-TBL-21: refetching disables pagination during page change', async () => {
		let resolvePage2!: (v: { items: IdentityUserListItemDto[]; total: number }) => void;
		const page2Pending = new Promise<{ items: IdentityUserListItemDto[]; total: number }>((res) => {
			resolvePage2 = res;
		});
		vi.spyOn(adminApi, 'listIdentityUsers')
			.mockResolvedValueOnce({ items: pageUsers(0, 10), total: 25 })
			.mockImplementationOnce(() => page2Pending);
		renderUsersList();
		await waitFor(() => expect(screen.getByText('user000')).toBeDefined());
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
		act(() => {
			resolvePage2({ items: pageUsers(10, 10), total: 25 });
		});
		await waitFor(() => expect(screen.getByText('user010')).toBeDefined());
	});

	it('WEB-IDN-TBL-22: groups and roles list APIs default to limit 10', async () => {
		const groupsSpy = vi
			.spyOn(adminApi, 'listIdentityGroups')
			.mockResolvedValue({ items: [], total: 0 });
		const rolesSpy = vi
			.spyOn(adminApi, 'listIdentityRoles')
			.mockResolvedValue({ items: [], total: 0 });
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/groups`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/groups`} element={<IdentityGroupsPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => expect(groupsSpy).toHaveBeenCalled());
		expect(groupsSpy.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ limit: 10 }));
		cleanup();
		renderWithUi(
			<MemoryRouter initialEntries={[`${IDENTITY_ROUTE_PREFIX}/roles`]}>
				<Routes>
					<Route path={`${IDENTITY_ROUTE_PREFIX}/roles`} element={<IdentityRolesPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => expect(rolesSpy).toHaveBeenCalled());
		expect(rolesSpy.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ limit: 10 }));
	});

	it('WEB-IDN-TBL-23: header subtitle shows total count', async () => {
		vi.spyOn(adminApi, 'listIdentityUsers').mockResolvedValue({
			items: pageUsers(0, 3),
			total: 42,
		});
		renderUsersList();
		await waitFor(() => expect(screen.getByText('42 total')).toBeDefined());
	});

	it('WEB-IDN-TBL-24: rapid double Next from page 0 lands on page 1 without stale rows', async () => {
		const listSpy = vi
			.spyOn(adminApi, 'listIdentityUsers')
			.mockResolvedValueOnce({ items: pageUsers(0, 10), total: 30 })
			.mockResolvedValueOnce({ items: pageUsers(10, 10), total: 30 })
			.mockResolvedValueOnce({ items: pageUsers(10, 10), total: 30 });
		renderUsersList();
		await waitFor(() =>
			expect(screen.getByRole('navigation', { name: 'Table pagination' })).toBeDefined(),
		);
		await waitFor(() => expect(screen.getByText('user000')).toBeDefined());
		const next = screen.getByRole('button', { name: 'Next' });
		fireEvent.click(next);
		fireEvent.click(next);
		await waitFor(
			() => {
				expect(screen.getByText('user010')).toBeDefined();
				expect(screen.queryByText('user000')).toBeNull();
			},
			{ timeout: 3000 },
		);
		const offsets = listSpy.mock.calls.map((c) => c[0]?.offset);
		expect(offsets.some((o) => o === 10)).toBe(true);
		expect(offsets.every((o) => o === undefined || o <= 10)).toBe(true);
	});

	it('WEB-IDN-TBL-12: aria-live region shows range after Next', async () => {
		vi.spyOn(adminApi, 'listIdentityUsers')
			.mockResolvedValueOnce({ items: pageUsers(0, 10), total: 11 })
			.mockResolvedValueOnce({ items: [mockUser(10)], total: 11 });
		const { container } = renderUsersList();
		await waitFor(() => expect(screen.getByText('user000')).toBeDefined());
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		await waitFor(() => expect(screen.getByText('user010')).toBeDefined());
		const live = container.querySelector('[aria-live="polite"]');
		expect(live?.textContent).toMatch(/11–11 of 11/);
	});
});
