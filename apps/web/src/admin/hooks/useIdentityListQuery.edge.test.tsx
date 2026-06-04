import { act, renderHook, waitFor } from '@testing-library/react';
import { IDENTITY_LIST_PAGE_SIZE } from '@nestidp/shared';
import type { IdentityUserListItemDto } from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useIdentityListQuery } from './useIdentityListQuery';

function mockUser(index: number): IdentityUserListItemDto {
	return {
		id: `user-${index}`,
		username: `user${index}`,
		email: null,
		displayName: null,
		active: true,
		externalId: `ext-${index}`,
		apiConnectionId: 'c1',
		origin: 'manual',
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('useIdentityListQuery edge (WEB-IDN-TBL-HK)', () => {
	it('WEB-IDN-TBL-HK-01: initialLoading until first fetch completes', async () => {
		let resolve!: (v: { items: IdentityUserListItemDto[]; total: number }) => void;
		const pending = new Promise<{ items: IdentityUserListItemDto[]; total: number }>((res) => {
			resolve = res;
		});
		const fetchPage = vi.fn(() => pending);

		const { result } = renderHook(() =>
			useIdentityListQuery<IdentityUserListItemDto>({
				fetchPage,
				mapError: (e) => String(e),
			}),
		);

		expect(result.current.initialLoading).toBe(true);
		expect(result.current.refetching).toBe(false);

		act(() => {
			resolve({ items: [mockUser(0)], total: 1 });
		});

		await waitFor(() => expect(result.current.initialLoading).toBe(false));
		expect(result.current.items).toHaveLength(1);
	});

	it('WEB-IDN-TBL-HK-02: mount fetch error sets error and finishes bootstrap', async () => {
		const fetchPage = vi.fn().mockRejectedValue(new Error('network down'));

		const { result } = renderHook(() =>
			useIdentityListQuery<IdentityUserListItemDto>({
				fetchPage,
				mapError: () => 'Load failed',
			}),
		);

		await waitFor(() => {
			expect(result.current.initialLoading).toBe(false);
			expect(result.current.error).toBe('Load failed');
		});
		expect(result.current.items).toHaveLength(0);
		expect(result.current.total).toBe(0);
	});

	it('WEB-IDN-TBL-HK-03: successful fetch clears prior error', async () => {
		const fetchPage = vi
			.fn()
			.mockRejectedValueOnce(new Error('fail'))
			.mockResolvedValueOnce({ items: [mockUser(1)], total: 1 });

		const { result } = renderHook(() =>
			useIdentityListQuery<IdentityUserListItemDto>({
				fetchPage,
				mapError: () => 'err',
			}),
		);

		await waitFor(() => expect(result.current.error).toBe('err'));

		act(() => {
			result.current.reload();
		});

		await waitFor(() => {
			expect(result.current.error).toBeNull();
			expect(result.current.items[0]?.username).toBe('user1');
		});
	});

	it('WEB-IDN-TBL-HK-04: reload uses current pageIndex and filters', async () => {
		const fetchPage = vi
			.fn()
			.mockResolvedValueOnce({
				items: Array.from({ length: 10 }, (_, i) => mockUser(i)),
				total: 25,
			})
			.mockResolvedValueOnce({
				items: Array.from({ length: 10 }, (_, i) => mockUser(i + 10)),
				total: 25,
			})
			.mockResolvedValueOnce({
				items: Array.from({ length: 10 }, (_, i) => mockUser(i + 10)),
				total: 25,
			});

		const { result } = renderHook(() =>
			useIdentityListQuery<IdentityUserListItemDto>({
				fetchPage,
				initialFilters: { origin: 'synced' },
				mapError: (e) => String(e),
			}),
		);

		await waitFor(() => expect(result.current.pageIndex).toBe(0));

		act(() => {
			result.current.goToPage(1);
		});
		await waitFor(() => expect(result.current.pageIndex).toBe(1));

		act(() => {
			result.current.reload();
		});

		await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(3));
		expect(fetchPage.mock.calls[2]?.[0]).toEqual(
			expect.objectContaining({
				offset: 10,
				limit: IDENTITY_LIST_PAGE_SIZE,
				filters: { origin: 'synced' },
			}),
		);
	});

	it('WEB-IDN-TBL-HK-05: applyFilters resets page index to zero', async () => {
		const fetchPage = vi
			.fn()
			.mockResolvedValueOnce({
				items: Array.from({ length: 10 }, (_, i) => mockUser(i)),
				total: 30,
			})
			.mockResolvedValueOnce({
				items: Array.from({ length: 10 }, (_, i) => mockUser(i + 10)),
				total: 30,
			})
			.mockResolvedValueOnce({ items: [mockUser(0)], total: 5 });

		const { result } = renderHook(() =>
			useIdentityListQuery<IdentityUserListItemDto>({
				fetchPage,
				mapError: (e) => String(e),
			}),
		);

		await waitFor(() => expect(result.current.pageIndex).toBe(0));

		act(() => {
			result.current.goToPage(1);
		});
		await waitFor(() => expect(result.current.pageIndex).toBe(1));

		act(() => {
			result.current.applyFilters({ origin: 'manual' });
		});

		await waitFor(() => {
			expect(result.current.pageIndex).toBe(0);
			expect(result.current.items[0]?.username).toBe('user0');
			expect(result.current.total).toBe(5);
		});
	});

	it('WEB-IDN-TBL-HK-06: clamp to page 0 when total becomes zero', async () => {
		const fetchPage = vi
			.fn()
			.mockResolvedValueOnce({
				items: Array.from({ length: 10 }, (_, i) => mockUser(i)),
				total: 25,
			})
			.mockResolvedValueOnce({ items: [], total: 0 });

		const { result } = renderHook(() =>
			useIdentityListQuery<IdentityUserListItemDto>({
				fetchPage,
				mapError: (e) => String(e),
			}),
		);

		await waitFor(() => expect(result.current.pageIndex).toBe(0));

		act(() => {
			result.current.goToPage(2);
		});

		await waitFor(() => {
			expect(result.current.pageIndex).toBe(0);
			expect(result.current.total).toBe(0);
			expect(result.current.items).toHaveLength(0);
		});
	});

	it('WEB-IDN-TBL-HK-07: superseded clamp refetch does not overwrite newer data', async () => {
		let resolveClamp!: (v: { items: IdentityUserListItemDto[]; total: number }) => void;
		const clampPending = new Promise<{ items: IdentityUserListItemDto[]; total: number }>((res) => {
			resolveClamp = res;
		});

		const fetchPage = vi
			.fn()
			.mockResolvedValueOnce({
				items: Array.from({ length: 10 }, (_, i) => mockUser(i)),
				total: 45,
			})
			.mockImplementationOnce(() => clampPending)
			.mockResolvedValueOnce({ items: [mockUser(50)], total: 1 });

		const { result } = renderHook(() =>
			useIdentityListQuery<IdentityUserListItemDto>({
				fetchPage,
				mapError: (e) => String(e),
			}),
		);

		await waitFor(() => expect(result.current.total).toBe(45));

		act(() => {
			result.current.goToPage(3);
		});
		await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));

		act(() => {
			result.current.applyFilters({ origin: 'x' });
		});
		await waitFor(() => expect(result.current.items[0]?.username).toBe('user50'));

		act(() => {
			resolveClamp({ items: [mockUser(30)], total: 15 });
		});
		await new Promise((r) => setTimeout(r, 30));
		expect(result.current.items[0]?.username).toBe('user50');
	});

	it('WEB-IDN-TBL-HK-08: error mid-pagination keeps pageIndex and prior items', async () => {
		const fetchPage = vi
			.fn()
			.mockResolvedValueOnce({
				items: Array.from({ length: 10 }, (_, i) => mockUser(i)),
				total: 30,
			})
			.mockResolvedValueOnce({
				items: Array.from({ length: 10 }, (_, i) => mockUser(i + 10)),
				total: 30,
			})
			.mockRejectedValueOnce(new Error('page 3 fail'));

		const { result } = renderHook(() =>
			useIdentityListQuery<IdentityUserListItemDto>({
				fetchPage,
				mapError: () => 'page failed',
			}),
		);

		await waitFor(() => expect(result.current.pageIndex).toBe(0));

		act(() => {
			result.current.goToPage(1);
		});
		await waitFor(() => expect(result.current.pageIndex).toBe(1));

		act(() => {
			result.current.goToPage(2);
		});

		await waitFor(() => {
			expect(result.current.error).toBe('page failed');
			expect(result.current.pageIndex).toBe(1);
			expect(result.current.items[0]?.username).toBe('user10');
		});
	});

	it('WEB-IDN-TBL-HK-09: refetching true only after first successful load', async () => {
		let resolve!: (v: { items: IdentityUserListItemDto[]; total: number }) => void;
		const pending = new Promise<{ items: IdentityUserListItemDto[]; total: number }>((res) => {
			resolve = res;
		});
		const fetchPage = vi
			.fn()
			.mockImplementationOnce(() => pending)
			.mockImplementationOnce(() => pending);

		const { result } = renderHook(() =>
			useIdentityListQuery<IdentityUserListItemDto>({
				fetchPage,
				mapError: (e) => String(e),
			}),
		);

		expect(result.current.refetching).toBe(false);

		act(() => {
			resolve({ items: [mockUser(0)], total: 15 });
		});
		await waitFor(() => expect(result.current.items).toHaveLength(1));

		act(() => {
			result.current.goToPage(1);
		});
		expect(result.current.refetching).toBe(true);

		act(() => {
			resolve({ items: Array.from({ length: 5 }, (_, i) => mockUser(i + 10)), total: 15 });
		});
		await waitFor(() => expect(result.current.refetching).toBe(false));
	});

	it('WEB-IDN-TBL-HK-10: exposes setPageIndex for URL sync preparation', () => {
		const fetchPage = vi.fn().mockResolvedValue({ items: [], total: 0 });
		const { result } = renderHook(() =>
			useIdentityListQuery({
				fetchPage,
				mapError: (e) => String(e),
			}),
		);
		expect(typeof result.current.setPageIndex).toBe('function');
	});
});
