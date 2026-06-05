import { cleanup, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AUDIT_ROUTE_PREFIX } from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { AuditLogPage } from '@/admin/pages/AuditLogPage';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('AuditLogPage Evergreen forms', () => {
	it('WEB-EVG-80: Filter button is primary Button', async () => {
		vi.spyOn(adminApi, 'listAuditEvents').mockResolvedValue({
			items: [],
			total: 0,
			limit: 50,
			offset: 0,
		});
		renderWithUi(
			<MemoryRouter initialEntries={[AUDIT_ROUTE_PREFIX]}>
				<Routes>
					<Route path={AUDIT_ROUTE_PREFIX} element={<AuditLogPage />} />
				</Routes>
			</MemoryRouter>,
		);
		await waitFor(() => screen.getByRole('button', { name: 'Filter' }));
		expect(screen.getByRole('button', { name: 'Filter' }).className).toContain('evg-btn--primary');
	});
});
