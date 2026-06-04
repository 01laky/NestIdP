import { cleanup, fireEvent, within } from '@testing-library/react';
import type { ColumnDef } from '@tanstack/react-table';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithUi } from '../../test/renderWithUi';
import { IdentityListTable } from './IdentityListTable';

type Row = { id: string; name: string };

const columns: ColumnDef<Row, unknown>[] = [
	{ id: 'name', header: 'Name', cell: ({ row }) => row.original.name },
];

function renderTable(props: Partial<Parameters<typeof IdentityListTable<Row>>[0]> = {}) {
	const onPageChange = vi.fn();
	const data =
		props.data ?? Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }));
	const view = renderWithUi(
		<IdentityListTable
			columns={columns}
			data={data}
			total={props.total ?? 25}
			pageIndex={props.pageIndex ?? 0}
			onPageChange={onPageChange}
			loading={props.loading}
		/>,
	);
	const pagination = () =>
		within(view.container).getByRole('navigation', { name: 'Table pagination' });
	return {
		onPageChange,
		container: view.container,
		pagination: () => within(pagination()),
	};
}

afterEach(() => {
	cleanup();
});

describe('IdentityListTable edge (WEB-IDN-TBL-CMP)', () => {
	it('WEB-IDN-TBL-CMP-01: renders nothing when total is zero', () => {
		const { container } = renderWithUi(
			<IdentityListTable
				columns={columns}
				data={[]}
				total={0}
				pageIndex={0}
				onPageChange={() => undefined}
			/>,
		);
		expect(container.querySelector('table.evg-table')).toBeNull();
		expect(container.querySelector('.evg-table-pagination')).toBeNull();
	});

	it('WEB-IDN-TBL-CMP-02: pagination nav aria-busy when loading', () => {
		const { container } = renderTable({ loading: true });
		const nav = within(container).getByRole('navigation', { name: 'Table pagination' });
		expect(nav.getAttribute('aria-busy')).toBe('true');
	});

	it('WEB-IDN-TBL-CMP-03: shows Page 1 of 1 for three items', () => {
		const { container } = renderTable({ data: [{ id: 'a', name: 'A' }], total: 3, pageIndex: 0 });
		const meta = container.querySelector('.evg-table-pagination__meta');
		expect(meta?.textContent).toContain('Page 1 of 1');
		expect(meta?.textContent).toContain('1–3 of 3');
	});

	it('WEB-IDN-TBL-CMP-04: last page range 21–25 of 25 on page index 2', () => {
		const data = Array.from({ length: 5 }, (_, i) => ({ id: `r${i + 20}`, name: `Row ${i + 20}` }));
		const { container } = renderTable({ data, total: 25, pageIndex: 2 });
		const meta = container.querySelector('.evg-table-pagination__meta');
		expect(meta?.textContent).toContain('21–25 of 25');
		expect(meta?.textContent).toContain('Page 3 of 3');
	});

	it('WEB-IDN-TBL-CMP-05: Next disabled on last page', () => {
		const { pagination } = renderTable({ total: 25, pageIndex: 2 });
		expect((pagination().getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});

	it('WEB-IDN-TBL-CMP-06: Previous disabled on first page', () => {
		const { pagination } = renderTable({ pageIndex: 0 });
		expect(
			(pagination().getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled,
		).toBe(true);
	});

	it('WEB-IDN-TBL-CMP-07: Next click invokes onPageChange with next index', () => {
		const { onPageChange, pagination } = renderTable({ pageIndex: 1, total: 25 });
		fireEvent.click(pagination().getByRole('button', { name: 'Next' }));
		expect(onPageChange).toHaveBeenCalledWith(2);
	});

	it('WEB-IDN-TBL-CMP-08: Previous click invokes onPageChange with prior index', () => {
		const { onPageChange, pagination } = renderTable({ pageIndex: 2, total: 25 });
		fireEvent.click(pagination().getByRole('button', { name: 'Previous' }));
		expect(onPageChange).toHaveBeenCalledWith(1);
	});

	it('WEB-IDN-TBL-CMP-09: both pagination buttons disabled while loading', () => {
		const { pagination } = renderTable({ loading: true, pageIndex: 1, total: 25 });
		expect((pagination().getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(
			true,
		);
		expect(
			(pagination().getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled,
		).toBe(true);
	});

	it('WEB-IDN-TBL-CMP-10: renders ten body rows for full page', () => {
		const { container } = renderWithUi(
			<IdentityListTable
				columns={columns}
				data={Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, name: `N${i}` }))}
				total={10}
				pageIndex={0}
				onPageChange={() => undefined}
			/>,
		);
		expect(container.querySelectorAll('tbody tr')).toHaveLength(10);
	});

	it('WEB-IDN-TBL-CMP-11: sr-only live region mirrors visible range', () => {
		const { container } = renderTable({
			total: 11,
			pageIndex: 1,
			data: [{ id: 'x', name: 'X' }],
		});
		const live = container.querySelector('.evg-sr-only[aria-live="polite"]');
		const meta = container.querySelector('.evg-table-pagination__meta');
		expect(live?.textContent).toBe('11–11 of 11');
		expect(meta?.textContent).toContain('11–11 of 11');
	});
});
