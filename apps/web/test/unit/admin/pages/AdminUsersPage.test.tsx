import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ADMIN_USERS_ROUTE_PREFIX } from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { AdminUsersPage } from '@/admin/pages/AdminUsersPage';

import { clickDialogCancel, clickDialogConfirm } from '@test/helpers/confirm-dialog-helpers';

function renderPage() {
	return renderWithUi(
		<MemoryRouter initialEntries={[ADMIN_USERS_ROUTE_PREFIX]}>
			<Routes>
				<Route path={ADMIN_USERS_ROUTE_PREFIX} element={<AdminUsersPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('AdminUsersPage', () => {
	it('WEB-ADM-70: lists admins and shows create form', async () => {
		vi.spyOn(adminApi, 'listAdminUsers').mockResolvedValue([
			{
				id: 'a1',
				username: 'admin',
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
		]);
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: 'a1', username: 'admin' },
			csrfToken: 'csrf',
		});

		renderPage();

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Admin accounts' })).toBeDefined();
			expect(screen.getByText('admin')).toBeDefined();
			expect(screen.getByRole('button', { name: 'Create admin' })).toBeDefined();
		});
	});

	it('WEB-ADM-71: password mismatch on create shows error', async () => {
		vi.spyOn(adminApi, 'listAdminUsers').mockResolvedValue([]);
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: 'a1', username: 'admin' },
			csrfToken: 'csrf',
		});

		renderPage();
		await waitFor(() => screen.getByLabelText(/^Username/));

		fireEvent.change(screen.getByLabelText(/^Username/), { target: { value: 'ops' } });
		fireEvent.change(document.querySelector('input[name="password"]')!, {
			target: { value: 'secret123456' },
		});
		fireEvent.change(document.querySelector('input[name="confirmPassword"]')!, {
			target: { value: 'different123456' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Create admin' }));

		await waitFor(() => {
			expect(screen.getByText('Passwords do not match')).toBeDefined();
		});
	});

	it('WEB-ADM-72: create admin calls API', async () => {
		vi.spyOn(adminApi, 'listAdminUsers')
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{
					id: 'a2',
					username: 'ops',
					createdAt: '2026-01-02T00:00:00.000Z',
					updatedAt: '2026-01-02T00:00:00.000Z',
				},
			]);
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: 'a1', username: 'admin' },
			csrfToken: 'csrf',
		});
		const createSpy = vi.spyOn(adminApi, 'createAdminUser').mockResolvedValue({
			id: 'a2',
			username: 'ops',
			createdAt: '2026-01-02T00:00:00.000Z',
			updatedAt: '2026-01-02T00:00:00.000Z',
		});

		renderPage();
		await waitFor(() => screen.getByLabelText(/^Username/));

		fireEvent.change(screen.getByLabelText(/^Username/), { target: { value: 'ops' } });
		fireEvent.change(document.querySelector('input[name="password"]')!, {
			target: { value: 'secret123456' },
		});
		fireEvent.change(document.querySelector('input[name="confirmPassword"]')!, {
			target: { value: 'secret123456' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Create admin' }));

		await waitFor(() => {
			expect(createSpy).toHaveBeenCalledWith({ username: 'ops', password: 'secret123456' });
		});
	});

	it('WEB-ADM-73: load failure shows error banner', async () => {
		vi.spyOn(adminApi, 'listAdminUsers').mockRejectedValue(
			new adminApi.AdminApiError(403, 'Forbidden'),
		);
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: 'a1', username: 'admin' },
			csrfToken: 'csrf',
		});

		renderPage();

		await waitFor(() => {
			expect(screen.getByText('Forbidden')).toBeDefined();
		});
	});

	it('WEB-ADM-74: delete confirm calls deleteAdminUser when confirmed', async () => {
		vi.spyOn(adminApi, 'listAdminUsers')
			.mockResolvedValueOnce([
				{
					id: 'a1',
					username: 'admin',
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
				{
					id: 'a2',
					username: 'ops',
					createdAt: '2026-01-02T00:00:00.000Z',
					updatedAt: '2026-01-02T00:00:00.000Z',
				},
			])
			.mockResolvedValueOnce([
				{
					id: 'a1',
					username: 'admin',
					createdAt: '2026-01-01T00:00:00.000Z',
					updatedAt: '2026-01-01T00:00:00.000Z',
				},
			]);
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: 'a1', username: 'admin' },
			csrfToken: 'csrf',
		});
		const deleteSpy = vi
			.spyOn(adminApi, 'deleteAdminUser')
			.mockResolvedValue({ ok: true, id: 'a2' });

		renderPage();
		await waitFor(() => screen.getByText('ops'));

		fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		await screen.findByRole('dialog');
		clickDialogConfirm('Delete');

		await waitFor(() => {
			expect(deleteSpy).toHaveBeenCalledWith('a2');
		});
	});

	it('WEB-ADM-CONF-10: delete admin cancel skips deleteAdminUser', async () => {
		vi.spyOn(adminApi, 'listAdminUsers').mockResolvedValue([
			{
				id: 'a1',
				username: 'admin',
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
			{
				id: 'a2',
				username: 'ops',
				createdAt: '2026-01-02T00:00:00.000Z',
				updatedAt: '2026-01-02T00:00:00.000Z',
			},
		]);
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: 'a1', username: 'admin' },
			csrfToken: 'csrf',
		});
		const deleteSpy = vi.spyOn(adminApi, 'deleteAdminUser');

		renderPage();
		await waitFor(() => screen.getByText('ops'));
		fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		await screen.findByRole('dialog');
		clickDialogCancel();
		expect(deleteSpy).not.toHaveBeenCalled();
	});

	it('WEB-ADM-75: cannot delete self shows em dash in actions', async () => {
		vi.spyOn(adminApi, 'listAdminUsers').mockResolvedValue([
			{
				id: 'a1',
				username: 'admin',
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
		]);
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: 'a1', username: 'admin' },
			csrfToken: 'csrf',
		});

		renderPage();

		await waitFor(() => {
			expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
		});
	});

	it('WEB-ADM-76: change-password mismatch shows error', async () => {
		vi.spyOn(adminApi, 'listAdminUsers').mockResolvedValue([]);
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: 'a1', username: 'admin' },
			csrfToken: 'csrf',
		});

		renderPage();
		await waitFor(() => screen.getByLabelText(/^Current password/));

		fireEvent.change(screen.getByLabelText(/^Current password/), {
			target: { value: 'oldpass123456' },
		});
		fireEvent.change(screen.getByLabelText(/^New password/), {
			target: { value: 'newpass123456' },
		});
		fireEvent.change(screen.getByLabelText(/^Confirm new password/), {
			target: { value: 'otherpass123456' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Update my password' }));

		await waitFor(() => {
			expect(screen.getByText('New passwords do not match')).toBeDefined();
		});
	});
});
