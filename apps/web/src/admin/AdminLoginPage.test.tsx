import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminLoginPage } from './AdminLoginPage';
import * as adminApi from './adminApi';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
	const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
	return {
		...actual,
		useNavigate: () => navigateMock,
	};
});

vi.mock('./adminRememberUsername', () => ({
	readRememberedAdminUsername: vi.fn(() => null),
	writeRememberedAdminUsername: vi.fn(),
	clearRememberedAdminUsername: vi.fn(),
}));

function usernameField() {
	return screen.getByRole('textbox', { name: /^Username/i });
}

function passwordField() {
	return screen.getByLabelText(/^Password/i);
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	navigateMock.mockReset();
});

describe('AdminLoginPage', () => {
	it('WEB-ADM-01: renders username/password fields', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockRejectedValue(
			new adminApi.AdminApiError(401, 'Unauthorized'),
		);

		render(
			<MemoryRouter>
				<AdminLoginPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(usernameField()).toBeDefined();
			expect(passwordField()).toBeDefined();
		});
	});

	it('WEB-ADM-02: submit calls adminApi.loginAdmin', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockRejectedValue(
			new adminApi.AdminApiError(401, 'Unauthorized'),
		);
		const loginSpy = vi.spyOn(adminApi, 'loginAdmin').mockResolvedValue({
			ok: true,
			admin: { id: '1', username: 'admin' },
			csrfToken: 'test-csrf-token',
		});

		render(
			<MemoryRouter>
				<AdminLoginPage />
			</MemoryRouter>,
		);

		await waitFor(() => usernameField());

		fireEvent.change(usernameField(), { target: { value: 'admin' } });
		fireEvent.change(passwordField(), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

		await waitFor(() => {
			expect(loginSpy).toHaveBeenCalledWith({
				username: 'admin',
				password: 'secret',
				rememberMe: false,
			});
		});
	});

	it('WEB-ADM-06: authenticated user redirects to /admin', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockResolvedValue({
			admin: { id: '1', username: 'admin' },
			csrfToken: 'test-csrf-token',
		});

		render(
			<MemoryRouter>
				<AdminLoginPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith('/admin', { replace: true });
		});
	});

	it('WEB-ADM-07: disables submit while loading', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockRejectedValue(
			new adminApi.AdminApiError(401, 'Unauthorized'),
		);
		vi.spyOn(adminApi, 'loginAdmin').mockImplementation(
			() =>
				new Promise((resolve) => {
					setTimeout(
						() =>
							resolve({
								ok: true,
								admin: { id: '1', username: 'admin' },
								csrfToken: 'test-csrf-token',
							}),
						100,
					);
				}),
		);

		render(
			<MemoryRouter>
				<AdminLoginPage />
			</MemoryRouter>,
		);

		await waitFor(() => usernameField());
		fireEvent.change(usernameField(), { target: { value: 'admin' } });
		fireEvent.change(passwordField(), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

		expect(screen.getByRole('button', { name: /Signing in/i }).hasAttribute('disabled')).toBe(true);

		await waitFor(() => {
			expect(screen.getByRole('button', { name: /Sign in/i }).hasAttribute('disabled')).toBe(false);
		});
	});

	it('WEB-ADM-10: shows generic error message on 401 login', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockRejectedValue(
			new adminApi.AdminApiError(401, 'Unauthorized'),
		);
		vi.spyOn(adminApi, 'loginAdmin').mockRejectedValue(
			new adminApi.AdminApiError(401, 'Invalid credentials'),
		);

		render(
			<MemoryRouter>
				<AdminLoginPage />
			</MemoryRouter>,
		);

		await waitFor(() => usernameField());
		fireEvent.change(usernameField(), { target: { value: 'admin' } });
		fireEvent.change(passwordField(), { target: { value: 'wrong' } });
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

		await waitFor(() => {
			expect(screen.getByText('Invalid credentials')).toBeDefined();
		});
	});

	it('WEB-ADM-11: shows rate limit message on 429 login', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockRejectedValue(
			new adminApi.AdminApiError(401, 'Unauthorized'),
		);
		vi.spyOn(adminApi, 'loginAdmin').mockRejectedValue(
			new adminApi.AdminApiError(429, 'Too many login attempts'),
		);

		render(
			<MemoryRouter>
				<AdminLoginPage />
			</MemoryRouter>,
		);

		await waitFor(() => usernameField());
		fireEvent.change(usernameField(), { target: { value: 'admin' } });
		fireEvent.change(passwordField(), { target: { value: 'wrong' } });
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

		await waitFor(() => {
			expect(screen.getByText('Too many login attempts')).toBeDefined();
		});
	});

	it('WEB-ADM-12: renders end-user SAML SSO link', async () => {
		vi.spyOn(adminApi, 'getAdminMe').mockRejectedValue(
			new adminApi.AdminApiError(401, 'Unauthorized'),
		);

		render(
			<MemoryRouter>
				<AdminLoginPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			const link = screen.getByRole('link', { name: /End-user SAML SSO login/i });
			expect(link.getAttribute('href')).toBe('/login');
		});
	});
});
