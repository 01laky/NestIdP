import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AdminUserPublicDto } from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { clickDialogConfirm } from '@test/helpers/confirm-dialog-helpers';
import { renderWithUi } from '@test/helpers/renderWithUi';
import { AdminUsersPage } from '@/admin/pages/AdminUsersPage';

function adminUser(overrides: Partial<AdminUserPublicDto> = {}): AdminUserPublicDto {
	return {
		id: 'a1',
		username: 'alice',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		lockout: { locked: false, lockedUntil: null, failedCount: 0, lastFailedAt: null },
		...overrides,
	};
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('WEB-LOCK: admin account lockout UI', () => {
	it('WEB-LOCK-01: a locked admin shows the Locked badge and Unlock calls unlockAdminUser', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: 'me', username: 'root' },
			csrfToken: 'csrf',
		} as never);
		vi.spyOn(adminApi, 'listAdminUsers').mockResolvedValue([
			adminUser({
				id: 'a1',
				username: 'locked-admin',
				lockout: {
					locked: true,
					lockedUntil: '2099-01-01T00:00:00.000Z',
					failedCount: 5,
					lastFailedAt: '2026-01-01T00:00:00.000Z',
				},
			}),
			adminUser({ id: 'me', username: 'root' }),
		]);
		const unlockSpy = vi
			.spyOn(adminApi, 'unlockAdminUser')
			.mockResolvedValue({ ok: true, id: 'a1' });

		renderWithUi(
			<MemoryRouter>
				<AdminUsersPage />
			</MemoryRouter>,
		);

		await screen.findByText('locked-admin');
		expect(screen.getByText('Locked')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
		await screen.findByRole('dialog');
		clickDialogConfirm('Unlock');
		await waitFor(() => expect(unlockSpy).toHaveBeenCalledWith('a1'));
	});

	it('WEB-LOCK-02: an unlocked admin shows no Unlock button', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: 'me', username: 'root' },
			csrfToken: 'csrf',
		} as never);
		vi.spyOn(adminApi, 'listAdminUsers').mockResolvedValue([
			adminUser({ id: 'a1', username: 'normal' }),
			adminUser({ id: 'me', username: 'root' }),
		]);

		renderWithUi(
			<MemoryRouter>
				<AdminUsersPage />
			</MemoryRouter>,
		);

		await screen.findByText('normal');
		expect(screen.queryByRole('button', { name: 'Unlock' })).toBeNull();
	});
});
