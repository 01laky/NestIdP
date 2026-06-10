import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AUDIT_ROUTE_PREFIX } from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { AuditLogPage } from '@/admin/pages/AuditLogPage';

function renderPage() {
	return renderWithUi(
		<MemoryRouter initialEntries={[AUDIT_ROUTE_PREFIX]}>
			<Routes>
				<Route path={AUDIT_ROUTE_PREFIX} element={<AuditLogPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('AuditLogPage', () => {
	it('WEB-ADM-74: loads audit events table', async () => {
		vi.spyOn(adminApi, 'listAuditEvents').mockResolvedValue({
			items: [
				{
					id: 'e1',
					createdAt: '2026-01-01T00:00:00.000Z',
					actorType: 'admin',
					actorId: 'a1',
					actorLabel: 'admin',
					category: 'admin_auth',
					event: 'admin_login_success',
					subjectType: null,
					subjectId: null,
					clientIp: null,
					metadata: null,
				},
			],
			total: 1,
			limit: 50,
			offset: 0,
		});

		renderPage();

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Audit log' })).toBeDefined();
			expect(screen.getByText('admin_login_success')).toBeDefined();
		});
	});

	it('WEB-ADM-75: filter apply calls list with category', async () => {
		const listSpy = vi.spyOn(adminApi, 'listAuditEvents').mockResolvedValue({
			items: [],
			total: 0,
			limit: 50,
			offset: 0,
		});

		renderPage();
		await waitFor(() => screen.getByLabelText('Category'));

		fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'admin_auth' } });
		fireEvent.click(screen.getByRole('button', { name: 'Filter' }));

		await waitFor(() => {
			expect(listSpy).toHaveBeenLastCalledWith(
				expect.objectContaining({ category: 'admin_auth', limit: '50', offset: '0' }),
			);
		});
	});

	it('WEB-ADM-79: load failure shows error banner', async () => {
		vi.spyOn(adminApi, 'listAuditEvents').mockRejectedValue(
			new adminApi.AdminApiError(500, 'Server error'),
		);

		renderPage();

		await waitFor(() => {
			expect(screen.getByText('Server error')).toBeDefined();
		});
	});

	it('WEB-ADM-80: event filter passed to list on Filter click', async () => {
		const listSpy = vi.spyOn(adminApi, 'listAuditEvents').mockResolvedValue({
			items: [],
			total: 0,
			limit: 50,
			offset: 0,
		});

		renderPage();
		await waitFor(() => screen.getByLabelText('Event'));

		fireEvent.change(screen.getByLabelText('Event'), {
			target: { value: 'admin_login_success' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Filter' }));

		await waitFor(() => {
			expect(listSpy).toHaveBeenLastCalledWith(
				expect.objectContaining({ event: 'admin_login_success' }),
			);
		});
	});

	it('WEB-ADM-81: export JSON opens URL with format param', async () => {
		vi.spyOn(adminApi, 'listAuditEvents').mockResolvedValue({
			items: [],
			total: 0,
			limit: 50,
			offset: 0,
		});
		vi.spyOn(adminApi, 'auditExportUrl').mockReturnValue(
			'/api/admin/audit-events/export?format=json',
		);
		const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Export JSON' }));
		fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));

		expect(openSpy).toHaveBeenCalledWith('/api/admin/audit-events/export?format=json', '_blank');
	});

	it('WEB-ADM-76: export buttons open export URL', async () => {
		vi.spyOn(adminApi, 'listAuditEvents').mockResolvedValue({
			items: [],
			total: 0,
			limit: 50,
			offset: 0,
		});
		vi.spyOn(adminApi, 'getCsrfToken').mockReturnValue('csrf-token');
		const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
		vi.spyOn(adminApi, 'auditExportUrl').mockReturnValue(
			'/api/admin/audit-events/export?format=csv',
		);

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Export CSV' }));

		fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

		expect(openSpy).toHaveBeenCalledWith('/api/admin/audit-events/export?format=csv', '_blank');
	});

	it('WEB-AUDIT-ENC-01: encryption audit events show human-readable labels', async () => {
		vi.spyOn(adminApi, 'listAuditEvents').mockResolvedValue({
			items: [
				{
					id: 'enc-1',
					createdAt: '2026-01-01T00:00:00.000Z',
					actorType: 'admin',
					actorId: 'a1',
					actorLabel: 'admin',
					category: 'admin_config',
					event: 'idp_encryption_cert_generated',
					subjectType: 'IdpSettings',
					subjectId: 'default',
					clientIp: null,
					metadata: null,
				},
			],
			total: 1,
			limit: 50,
			offset: 0,
		});

		renderPage();

		await waitFor(() => {
			expect(screen.getByText('Encryption certificate generated')).toBeDefined();
			expect(screen.queryByText('idp_encryption_cert_generated')).toBeNull();
		});
	});

	it('WEB-ADM-105: Next requests the next offset page and Previous is disabled on page 1', async () => {
		const listSpy = vi.spyOn(adminApi, 'listAuditEvents').mockResolvedValue({
			items: [],
			total: 120,
			limit: 50,
			offset: 0,
		});

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Next' }));

		expect(screen.getByText('Page 1 of 3')).toBeDefined();
		expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(
			true,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		await waitFor(() => {
			expect(listSpy).toHaveBeenLastCalledWith(
				expect.objectContaining({ limit: '50', offset: '50' }),
			);
			expect(screen.getByText('Page 2 of 3')).toBeDefined();
		});
		expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(
			false,
		);
	});

	it('WEB-ADM-106: Filter submit resets pagination to the first page', async () => {
		const listSpy = vi.spyOn(adminApi, 'listAuditEvents').mockResolvedValue({
			items: [],
			total: 120,
			limit: 50,
			offset: 0,
		});

		renderPage();
		await waitFor(() => screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		await waitFor(() => {
			expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ offset: '50' }));
		});

		fireEvent.click(screen.getByRole('button', { name: 'Filter' }));

		await waitFor(() => {
			expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ offset: '0' }));
			expect(screen.getByText('Page 1 of 3')).toBeDefined();
		});
	});
});
