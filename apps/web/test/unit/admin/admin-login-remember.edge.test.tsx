import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as adminApi from '@/admin/adminApi';
import { AdminLoginPage } from '@/admin/AdminLoginPage';
import * as remember from '@/admin/adminRememberUsername';
import { webSrc } from '@test/helpers/paths';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
	const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
	return {
		...actual,
		useNavigate: () => navigateMock,
	};
});

vi.mock('@/admin/adminRememberUsername', () => ({
	readRememberedAdminUsername: vi.fn(),
	writeRememberedAdminUsername: vi.fn(),
	clearRememberedAdminUsername: vi.fn(),
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	navigateMock.mockReset();
});

function renderLogin(initialEntry = '/admin/login') {
	return render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<Routes>
				<Route path="/admin/login" element={<AdminLoginPage />} />
			</Routes>
		</MemoryRouter>,
	);
}

function usernameField() {
	return screen.getByRole('textbox', { name: /^Username/i });
}

function passwordField() {
	return screen.getByLabelText(/^Password/i);
}

describe('Admin login remember — edge (WEB-ADM-RM)', () => {
	beforeEach(() => {
		vi.spyOn(adminApi, 'getAdminMe').mockRejectedValue(
			new adminApi.AdminApiError(401, 'Unauthorized'),
		);
		vi.mocked(remember.readRememberedAdminUsername).mockReturnValue(null);
	});

	it('WEB-ADM-RM-06: renders both checkboxes', async () => {
		renderLogin();
		await waitFor(() => {
			expect(screen.getByRole('checkbox', { name: /Remember username/i })).toBeDefined();
			expect(screen.getByRole('checkbox', { name: /Stay signed in/i })).toBeDefined();
		});
	});

	it('WEB-ADM-RM-07: prefills username when storage mock returns value', async () => {
		vi.mocked(remember.readRememberedAdminUsername).mockReturnValue('saved-op');
		renderLogin();
		await waitFor(() => {
			expect((usernameField() as HTMLInputElement).value).toBe('saved-op');
			expect(
				(screen.getByRole('checkbox', { name: /Remember username/i }) as HTMLInputElement).checked,
			).toBe(true);
		});
	});

	it('WEB-ADM-RM-08: staySignedIn checked sends rememberMe true', async () => {
		const loginSpy = vi.spyOn(adminApi, 'loginAdmin').mockResolvedValue({
			ok: true,
			admin: { id: '1', username: 'admin' },
			csrfToken: 'csrf',
		});
		renderLogin();
		await waitFor(() => usernameField());
		fireEvent.change(usernameField(), { target: { value: 'admin' } });
		fireEvent.change(passwordField(), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('checkbox', { name: /Stay signed in/i }));
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));
		await waitFor(() => {
			expect(loginSpy).toHaveBeenCalledWith({
				username: 'admin',
				password: 'secret',
				rememberMe: true,
			});
		});
	});

	it('WEB-ADM-RM-09: rememberUsername only writes storage with rememberMe false', async () => {
		vi.spyOn(adminApi, 'loginAdmin').mockResolvedValue({
			ok: true,
			admin: { id: '1', username: 'admin' },
			csrfToken: 'csrf',
		});
		renderLogin();
		await waitFor(() => usernameField());
		fireEvent.change(usernameField(), { target: { value: '  alice  ' } });
		fireEvent.change(passwordField(), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('checkbox', { name: /Remember username/i }));
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));
		await waitFor(() => {
			expect(remember.writeRememberedAdminUsername).toHaveBeenCalledWith('alice');
		});
		expect(adminApi.loginAdmin).toHaveBeenCalledWith(
			expect.objectContaining({ rememberMe: false }),
		);
	});

	it('WEB-ADM-RM-10: neither checked clears storage on success', async () => {
		vi.spyOn(adminApi, 'loginAdmin').mockResolvedValue({
			ok: true,
			admin: { id: '1', username: 'admin' },
			csrfToken: 'csrf',
		});
		renderLogin();
		await waitFor(() => usernameField());
		fireEvent.change(usernameField(), { target: { value: 'admin' } });
		fireEvent.change(passwordField(), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));
		await waitFor(() => {
			expect(remember.clearRememberedAdminUsername).toHaveBeenCalled();
		});
	});

	it('WEB-ADM-RM-11: failed login does not call write or clear', async () => {
		vi.spyOn(adminApi, 'loginAdmin').mockRejectedValue(
			new adminApi.AdminApiError(401, 'Invalid credentials'),
		);
		renderLogin();
		await waitFor(() => usernameField());
		fireEvent.change(usernameField(), { target: { value: 'admin' } });
		fireEvent.change(passwordField(), { target: { value: 'wrong' } });
		fireEvent.click(screen.getByRole('checkbox', { name: /Remember username/i }));
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));
		await waitFor(() => expect(screen.getByText('Invalid credentials')).toBeDefined());
		expect(remember.writeRememberedAdminUsername).not.toHaveBeenCalled();
		expect(remember.clearRememberedAdminUsername).not.toHaveBeenCalled();
	});

	it('WEB-ADM-RM-12: AdminLoginPage does not reference localStorage directly', () => {
		const src = readFileSync(join(webSrc, 'admin/AdminLoginPage.tsx'), 'utf8');
		expect(src).not.toContain('localStorage');
	});

	it('WEB-ADM-RM-13: session_expired query shows warning callout', async () => {
		renderLogin('/admin/login?reason=session_expired');
		await waitFor(() => {
			expect(screen.getByText(/session has expired/i)).toBeDefined();
		});
	});

	it('WEB-ADM-RM-14: sharedComputerWarning when either checkbox checked', async () => {
		renderLogin();
		await waitFor(() => screen.getByRole('checkbox', { name: /Stay signed in/i }));
		fireEvent.click(screen.getByRole('checkbox', { name: /Stay signed in/i }));
		expect(screen.getByText(/shared or public computers/i)).toBeDefined();
	});

	it('WEB-ADM-RM-15: staySignedIn defaults false when storage prefills username', async () => {
		vi.mocked(remember.readRememberedAdminUsername).mockReturnValue('saved-op');
		renderLogin();
		await waitFor(() => {
			expect(
				(screen.getByRole('checkbox', { name: /Stay signed in/i }) as HTMLInputElement).checked,
			).toBe(false);
		});
	});

	it('WEB-ADM-RM-23: both options sends rememberMe true and writes trimmed username', async () => {
		const loginSpy = vi.spyOn(adminApi, 'loginAdmin').mockResolvedValue({
			ok: true,
			admin: { id: '1', username: 'admin' },
			csrfToken: 'csrf',
		});
		renderLogin();
		await waitFor(() => usernameField());
		fireEvent.change(usernameField(), { target: { value: '  dual-op  ' } });
		fireEvent.change(passwordField(), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('checkbox', { name: /Remember username/i }));
		fireEvent.click(screen.getByRole('checkbox', { name: /Stay signed in/i }));
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));
		await waitFor(() => {
			expect(loginSpy).toHaveBeenCalledWith({
				username: '  dual-op  ',
				password: 'secret',
				rememberMe: true,
			});
			expect(remember.writeRememberedAdminUsername).toHaveBeenCalledWith('dual-op');
		});
	});

	it('WEB-ADM-RM-24: unchecking remember username clears storage on success', async () => {
		vi.mocked(remember.readRememberedAdminUsername).mockReturnValue('saved-op');
		vi.spyOn(adminApi, 'loginAdmin').mockResolvedValue({
			ok: true,
			admin: { id: '1', username: 'admin' },
			csrfToken: 'csrf',
		});
		renderLogin();
		await waitFor(() => usernameField());
		fireEvent.change(passwordField(), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('checkbox', { name: /Remember username/i }));
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));
		await waitFor(() => {
			expect(remember.clearRememberedAdminUsername).toHaveBeenCalled();
		});
		expect(remember.writeRememberedAdminUsername).not.toHaveBeenCalled();
	});

	it('WEB-ADM-RM-25: sharedComputerWarning hidden when both checkboxes unchecked', async () => {
		renderLogin();
		await waitFor(() => usernameField());
		expect(screen.queryByText(/shared or public computers/i)).toBeNull();
	});

	it('WEB-ADM-RM-26: stay signed in hint mentions 30 days', async () => {
		renderLogin();
		await waitFor(() => screen.getByText(/up to 30 days/i));
	});

	it('WEB-ADM-RM-27: 429 rate limit does not write or clear storage', async () => {
		vi.spyOn(adminApi, 'loginAdmin').mockRejectedValue(
			new adminApi.AdminApiError(429, 'Too many login attempts'),
		);
		renderLogin();
		await waitFor(() => usernameField());
		fireEvent.change(usernameField(), { target: { value: 'admin' } });
		fireEvent.change(passwordField(), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('checkbox', { name: /Remember username/i }));
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));
		await waitFor(() => expect(screen.getByText(/Too many attempts/i)).toBeDefined());
		expect(remember.writeRememberedAdminUsername).not.toHaveBeenCalled();
		expect(remember.clearRememberedAdminUsername).not.toHaveBeenCalled();
	});

	it('WEB-ADM-RM-28: unknown reason query does not show session expired callout', async () => {
		renderLogin('/admin/login?reason=other');
		await waitFor(() => usernameField());
		expect(screen.queryByText(/session has expired/i)).toBeNull();
	});
});
