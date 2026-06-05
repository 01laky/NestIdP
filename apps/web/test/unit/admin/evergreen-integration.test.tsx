import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { AdminLoginPage } from '@/admin/AdminLoginPage';
import { webSrc } from '@test/helpers/paths';

const adminLayoutPath = join(webSrc, 'admin/AdminLayout.tsx');

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('Evergreen integration', () => {
	it('WEB-EVG-06: AdminLoginPage renders branded card heading', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockRejectedValue(
			new adminApi.AdminApiError(401, 'Unauthorized'),
		);

		render(
			<MemoryRouter>
				<AdminLoginPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Admin Login' })).toBeDefined();
			expect(document.querySelector('.evg-auth-layout')).toBeDefined();
		});
	});

	it('WEB-EVG-10: AdminLayout does not use legacy admin-shell class', () => {
		const source = readFileSync(adminLayoutPath, 'utf8');
		expect(source).not.toContain('admin-shell');
		expect(source).not.toContain('admin-sidebar');
		expect(source).toContain('AppShell');
	});
});
