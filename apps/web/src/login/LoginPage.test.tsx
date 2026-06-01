import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as authApi from '../auth/authApi';
import { LoginPage } from './LoginPage';

vi.mock('../auth/authApi', () => ({
	AuthApiError: class AuthApiError extends Error {
		constructor(
			public readonly statusCode: number,
			message: string,
		) {
			super(message);
			this.name = 'AuthApiError';
		}
	},
	getEndUserSession: vi.fn(),
	loginEndUser: vi.fn(),
	completeSsoLogin: vi.fn(),
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function renderLogin(initialPath = '/login') {
	return render(
		<MemoryRouter initialEntries={[initialPath]}>
			<LoginPage />
		</MemoryRouter>,
	);
}

describe('LoginPage', () => {
	beforeEach(() => {
		vi.mocked(authApi.getEndUserSession).mockResolvedValue({
			authenticated: false,
			user: null,
			samlSession: null,
		});
	});

	it('WEB-AUTH-01: renders SAML login heading', () => {
		renderLogin();
		expect(screen.getByRole('heading', { name: 'SAML Login' })).toBeDefined();
	});

	it('WEB-AUTH-02: renders enabled username and password fields', () => {
		renderLogin();
		const username = screen.getByLabelText(/Username/i) as HTMLInputElement;
		const password = screen.getByLabelText(/Password/i) as HTMLInputElement;
		expect(username.disabled).toBe(false);
		expect(password.disabled).toBe(false);
		expect(password.type).toBe('password');
	});

	it('WEB-AUTH-03: successful login shows signed-in message', async () => {
		vi.mocked(authApi.loginEndUser).mockResolvedValue({
			ok: true,
			samlSessionBound: false,
			user: {
				id: 'u1',
				username: 'alice',
				email: null,
				displayName: null,
				groups: [],
				roles: [],
			},
		});

		renderLogin();
		fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'alice' } });
		fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

		await waitFor(() => {
			expect(screen.getByText(/Signed in as alice/i)).toBeDefined();
		});
		expect(authApi.loginEndUser).toHaveBeenCalledWith({
			username: 'alice',
			password: 'secret',
			samlSessionId: undefined,
		});
	});

	it('WEB-AUTH-04: failed login shows API error message', async () => {
		vi.mocked(authApi.loginEndUser).mockRejectedValue(
			new authApi.AuthApiError(401, 'Invalid username or password'),
		);

		renderLogin();
		fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'alice' } });
		fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'wrong' } });
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

		await waitFor(() => {
			expect(screen.getByRole('alert').textContent).toContain('Invalid username or password');
		});
	});

	it('WEB-AUTH-05: passes samlSessionId from query to loginEndUser', async () => {
		const sessionId = 'clxxxxxxxxxxxxxxxxxxxxxxxxx';
		vi.mocked(authApi.loginEndUser).mockResolvedValue({
			ok: true,
			samlSessionBound: true,
			user: {
				id: 'u1',
				username: 'alice',
				email: null,
				displayName: null,
				groups: [],
				roles: [],
			},
		});

		renderLogin(`/login?samlSessionId=${sessionId}`);
		fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'alice' } });
		fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

		await waitFor(() => {
			expect(authApi.loginEndUser).toHaveBeenCalledWith({
				username: 'alice',
				password: 'secret',
				samlSessionId: sessionId,
			});
		});
	});

	it('WEB-AUTH-06: shows session banner when already authenticated', async () => {
		vi.mocked(authApi.getEndUserSession).mockResolvedValue({
			authenticated: true,
			user: {
				id: 'u1',
				username: 'alice',
				email: null,
				displayName: null,
				groups: [],
				roles: [],
			},
			samlSession: null,
		});

		renderLogin();
		await waitFor(() => {
			expect(screen.getByText(/Signed in as alice/i)).toBeDefined();
		});
	});

	it('WEB-AUTH-08: shows 429 rate limit message from API', async () => {
		vi.mocked(authApi.loginEndUser).mockRejectedValue(
			new authApi.AuthApiError(429, 'Too many login attempts'),
		);

		renderLogin();
		fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'alice' } });
		fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

		await waitFor(() => {
			expect(screen.getByRole('alert').textContent).toContain('Too many login attempts');
		});
	});

	it('WEB-AUTH-09: expired SAML session shows banner on mount', async () => {
		vi.mocked(authApi.getEndUserSession).mockResolvedValue({
			authenticated: false,
			user: null,
			samlSession: {
				id: 'sess-1',
				bound: false,
				expired: true,
				spActive: true,
			},
		});

		renderLogin('/login?samlSessionId=clxxxxxxxxxxxxxxxxxxxxxxxxx');
		await waitFor(() => {
			expect(screen.getByText(/SAML session expired/i)).toBeDefined();
		});
	});

	it('WEB-AUTH-10: SSO continue button calls completeSsoLogin stub', async () => {
		const sessionId = 'clxxxxxxxxxxxxxxxxxxxxxxxxx';
		vi.mocked(authApi.loginEndUser).mockResolvedValue({
			ok: true,
			samlSessionBound: true,
			user: {
				id: 'u1',
				username: 'alice',
				email: null,
				displayName: null,
				groups: [],
				roles: [],
			},
		});
		vi.mocked(authApi.completeSsoLogin).mockResolvedValue({
			status: 'not_implemented',
			message: 'SAML response delivery is not implemented yet. See Prompt 07.',
			samlSessionId: sessionId,
		});

		renderLogin(`/login?samlSessionId=${sessionId}`);
		fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'alice' } });
		fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

		await waitFor(() => {
			expect(screen.getByRole('button', { name: /Continue to application/i })).toBeDefined();
		});

		fireEvent.click(screen.getByRole('button', { name: /Continue to application/i }));
		await waitFor(() => {
			expect(authApi.completeSsoLogin).toHaveBeenCalledWith(sessionId);
			expect(screen.getByText(/Prompt 07/i)).toBeDefined();
		});
	});

	it('WEB-AUTH-11: disables form while signing in', async () => {
		let resolveLogin!: (value: Awaited<ReturnType<typeof authApi.loginEndUser>>) => void;
		vi.mocked(authApi.loginEndUser).mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveLogin = resolve;
				}),
		);

		renderLogin();
		fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'alice' } });
		fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

		await waitFor(() => {
			expect(screen.getByRole('button', { name: /Signing in/i })).toBeDefined();
		});
		expect((screen.getByLabelText(/Username/i) as HTMLInputElement).disabled).toBe(true);

		resolveLogin({
			ok: true,
			samlSessionBound: false,
			user: {
				id: 'u1',
				username: 'alice',
				email: null,
				displayName: null,
				groups: [],
				roles: [],
			},
		});
	});

	it('WEB-AUTH-07: links back to admin console', () => {
		renderLogin();
		const link = screen.getByRole('link', { name: 'Back to admin' });
		expect(link.getAttribute('href')).toBe('/admin');
	});
});
