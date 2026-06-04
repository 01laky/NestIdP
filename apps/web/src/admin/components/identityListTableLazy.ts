import { lazy, type ComponentType } from 'react';
import type { IdentityListTableProps } from './IdentityListTable';

export function createLazyIdentityListTable<T extends { id: string }>() {
	return lazy(() =>
		import('./IdentityListTable').then((m) => ({ default: m.IdentityListTable })),
	) as unknown as ComponentType<IdentityListTableProps<T>>;
}
