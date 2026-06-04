import { useCallback, useEffect, useRef, useState } from 'react';
import { IDENTITY_LIST_PAGE_SIZE } from '@nestidp/shared';

export type IdentityListFilters = Record<string, string | undefined>;

type FetchPageFn<T> = (args: {
	offset: number;
	limit: number;
	filters: IdentityListFilters;
}) => Promise<{ items: T[]; total: number }>;

export function useIdentityListQuery<T>(options: {
	fetchPage: FetchPageFn<T>;
	initialFilters?: IdentityListFilters;
	mapError: (err: unknown) => string;
}) {
	const { fetchPage, initialFilters = {}, mapError } = options;
	const [pageIndex, setPageIndex] = useState(0);
	const [filters, setFilters] = useState<IdentityListFilters>(initialFilters);
	const [items, setItems] = useState<T[]>([]);
	const [total, setTotal] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [refetching, setRefetching] = useState(false);
	const [bootstrapped, setBootstrapped] = useState(false);
	const hasLoadedOnceRef = useRef(false);
	const requestIdRef = useRef(0);

	const initialLoading = !bootstrapped;

	const runLoad = useCallback(
		async (targetPageIndex: number, activeFilters: IdentityListFilters) => {
			const requestId = ++requestIdRef.current;
			if (hasLoadedOnceRef.current) {
				setRefetching(true);
			}
			setError(null);
			try {
				let index = targetPageIndex;
				let result = await fetchPage({
					offset: index * IDENTITY_LIST_PAGE_SIZE,
					limit: IDENTITY_LIST_PAGE_SIZE,
					filters: activeFilters,
				});
				if (requestId !== requestIdRef.current) {
					return;
				}

				const pageCount =
					result.total === 0 ? 0 : Math.ceil(result.total / IDENTITY_LIST_PAGE_SIZE);
				if (result.total === 0) {
					index = 0;
				} else if (pageCount > 0 && index >= pageCount) {
					index = pageCount - 1;
					result = await fetchPage({
						offset: index * IDENTITY_LIST_PAGE_SIZE,
						limit: IDENTITY_LIST_PAGE_SIZE,
						filters: activeFilters,
					});
					if (requestId !== requestIdRef.current) {
						return;
					}
				}

				setPageIndex(index);
				setItems(result.items);
				setTotal(result.total);
				hasLoadedOnceRef.current = true;
			} catch (err) {
				if (requestId !== requestIdRef.current) {
					return;
				}
				setError(mapError(err));
			} finally {
				if (requestId === requestIdRef.current) {
					setRefetching(false);
					setBootstrapped(true);
				}
			}
		},
		[fetchPage, mapError],
	);

	useEffect(() => {
		void runLoad(0, initialFilters);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only initial load
	}, []);

	const applyFilters = useCallback(
		(nextFilters: IdentityListFilters) => {
			setFilters(nextFilters);
			void runLoad(0, nextFilters);
		},
		[runLoad],
	);

	const goToPage = useCallback(
		(index: number) => {
			void runLoad(index, filters);
		},
		[runLoad, filters],
	);

	const reload = useCallback(() => {
		void runLoad(pageIndex, filters);
	}, [runLoad, pageIndex, filters]);

	// v1.2: sync pageIndex ↔ searchParams.get('page')

	return {
		pageIndex,
		setPageIndex,
		total,
		items,
		error,
		initialLoading,
		refetching,
		applyFilters,
		goToPage,
		reload,
	};
}
