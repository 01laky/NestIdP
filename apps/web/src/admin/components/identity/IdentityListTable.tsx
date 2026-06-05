import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { IDENTITY_LIST_PAGE_SIZE } from '@nestidp/shared';
import { Button, Table } from '../../../ui';

export type IdentityListTableProps<T extends { id: string }> = {
	columns: ColumnDef<T, unknown>[];
	data: T[];
	total: number;
	pageIndex: number;
	onPageChange: (pageIndex: number) => void;
	loading?: boolean;
	getRowId?: (row: T) => string;
};

export function IdentityListTable<T extends { id: string }>({
	columns,
	data,
	total,
	pageIndex,
	onPageChange,
	loading = false,
	getRowId = (row) => row.id,
}: IdentityListTableProps<T>) {
	const { t } = useTranslation('common');
	const pageSize = IDENTITY_LIST_PAGE_SIZE;
	const pageCount = total === 0 ? 0 : Math.ceil(total / pageSize);
	const from = total === 0 ? 0 : pageIndex * pageSize + 1;
	const to = total === 0 ? 0 : Math.min((pageIndex + 1) * pageSize, total);
	const totalPages = pageCount;
	const currentPage = pageIndex + 1;

	const table = useReactTable({
		data,
		columns,
		pageCount,
		state: {
			pagination: { pageIndex, pageSize },
		},
		onPaginationChange: (updater) => {
			const prev = { pageIndex, pageSize };
			const next = typeof updater === 'function' ? updater(prev) : updater;
			onPageChange(next.pageIndex);
		},
		manualPagination: true,
		getCoreRowModel: getCoreRowModel(),
		getRowId,
	});

	if (total === 0) {
		return null;
	}

	const atFirst = pageIndex <= 0;
	const atLast = pageCount === 0 || pageIndex >= pageCount - 1;

	return (
		<>
			<div aria-busy={loading}>
				<Table>
					<thead>
						{table.getHeaderGroups().map((headerGroup) => (
							<tr key={headerGroup.id}>
								{headerGroup.headers.map((header) => (
									<th key={header.id}>
										{header.isPlaceholder
											? null
											: flexRender(header.column.columnDef.header, header.getContext())}
									</th>
								))}
							</tr>
						))}
					</thead>
					<tbody>
						{table.getRowModel().rows.map((row) => (
							<tr key={row.id}>
								{row.getVisibleCells().map((cell) => (
									<td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
								))}
							</tr>
						))}
					</tbody>
				</Table>
			</div>
			<nav className="evg-table-pagination" aria-label={t('paginationNav')} aria-busy={loading}>
				<p className="evg-sr-only" aria-live="polite" aria-atomic="true">
					{t('paginationRange', { from, to, total })}
				</p>
				<p className="evg-table-pagination__meta">
					<span>{t('paginationRange', { from, to, total })}</span>
					<span>{t('paginationPage', { current: currentPage, totalPages })}</span>
				</p>
				<div className="evg-table-pagination__actions">
					<Button
						type="button"
						variant="secondary"
						disabled={atFirst || loading}
						onClick={() => onPageChange(pageIndex - 1)}
					>
						{t('paginationPrevious')}
					</Button>
					<Button
						type="button"
						variant="secondary"
						disabled={atLast || loading}
						onClick={() => onPageChange(pageIndex + 1)}
					>
						{t('paginationNext')}
					</Button>
				</div>
			</nav>
		</>
	);
}
