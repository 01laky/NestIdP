import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Table } from '@/ui/Table';

afterEach(() => {
	cleanup();
});

describe('Table', () => {
	it('WEB-EVG-04: wraps children in scroll container', () => {
		render(
			<Table>
				<thead>
					<tr>
						<th>Name</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Acme</td>
					</tr>
				</tbody>
			</Table>,
		);

		const wrap = screen.getByTestId('evg-table-wrap');
		expect(wrap.className).toContain('evg-table-wrap');
		expect(wrap.querySelector('table.evg-table')).toBeDefined();
		expect(screen.getByText('Acme')).toBeDefined();
	});
});
