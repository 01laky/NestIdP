import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as authApi from '@/auth/authApi';
import { LoginPage } from '@/login/LoginPage';

vi.mock('@/auth/authApi', () => ({
	AuthApiError: class AuthApiError extends Error {
		constructor(
			public readonly statusCode: number,
			message: string,
			public readonly retryAfterSeconds?: number,
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

async function waitForLoginForm() {
	await waitFor(() => {
		expect(screen.getByRole('heading', { name: 'SAML Login' })).toBeDefined();
	});
}

describe('LoginPage', () => {
	beforeEach(() => {
		vi.spyOn(document, 'open').mockImplementation(() => window);
		vi.spyOn(document, 'write').mockImplementation(() => undefined);
		vi.spyOn(document, 'close').mockImplementation(() => undefined);
		vi.mocked(authApi.completeSsoLogin).mockResolvedValue('<html><form></form></html>');
		// Strict SP-only IdP (Prompt 36, Deliverable 10): the login form renders only with a live pending
		// request, so the default probe returns an unbound, non-expired SamlSession in context.
		vi.mocked(authApi.getEndUserSession).mockResolvedValue({
			authenticated: false,
			user: null,
			samlSession: {
				id: 'pending-req',
				bound: false,
				expired: false,
				spActive: true,
				readyToComplete: false,
			},
		});
	});

	it('WEB-AUTH-01: renders SAML login heading', async () => {
		renderLogin();
		await waitForLoginForm();
	});

	it('WEB-AUTH-02: renders enabled username and password fields', async () => {
		renderLogin();
		await waitForLoginForm();
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
		await waitForLoginForm();
		fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'alice' } });
		fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

		await waitFor(() => {
			expect(screen.getByRole('status').textContent).toContain('Signed in as alice');
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
		await waitForLoginForm();
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
		await waitForLoginForm();
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

	it('LOGIN-GATE-01: no pending SSO request → neutral notice, no login form / username field', async () => {
		vi.mocked(authApi.getEndUserSession).mockResolvedValue({
			authenticated: false,
			user: null,
			samlSession: null,
		});

		renderLogin();
		await waitFor(() => {
			expect(screen.getByText(/through your application/i)).toBeDefined();
		});
		expect(screen.queryByLabelText(/Username/i)).toBeNull();
		expect(screen.queryByRole('button', { name: /Sign in/i })).toBeNull();
	});

	it('WEB-AUTH-08: shows a localized rate-limit message on 429', async () => {
		vi.mocked(authApi.loginEndUser).mockRejectedValue(
			new authApi.AuthApiError(429, 'Too many login attempts'),
		);

		renderLogin();
		await waitForLoginForm();
		fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'alice' } });
		fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

		await waitFor(() => {
			expect(screen.getByRole('alert').textContent).toContain('Too many attempts');
		});
	});

	it('WEB-AUTH-08b: shows a countdown when the API returns Retry-After', async () => {
		vi.mocked(authApi.loginEndUser).mockRejectedValue(
			new authApi.AuthApiError(429, 'Too many login attempts', 30),
		);

		renderLogin();
		await waitForLoginForm();
		fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'alice' } });
		fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

		await waitFor(() => {
			expect(screen.getByRole('alert').textContent).toContain('30');
		});
	});

	it('WEB-AUTH-09 / LOGIN-GATE: an expired SAML session is not a valid request → neutral notice', async () => {
		vi.mocked(authApi.getEndUserSession).mockResolvedValue({
			authenticated: false,
			user: null,
			samlSession: {
				id: 'sess-1',
				bound: false,
				expired: true,
				spActive: true,
				readyToComplete: false,
			},
		});

		renderLogin('/login?samlSessionId=clxxxxxxxxxxxxxxxxxxxxxxxxx');
		await waitFor(() => {
			expect(screen.getByText(/through your application/i)).toBeDefined();
		});
		expect(screen.queryByLabelText(/Username/i)).toBeNull();
	});

	it('WEB-AUTH-10: SSO continue button calls completeSsoLogin with HTML', async () => {
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
		vi.mocked(authApi.completeSsoLogin).mockResolvedValue(
			'<html><form><input name="SAMLResponse" value="abc"/></form></html>',
		);

		renderLogin(`/login?samlSessionId=${sessionId}`);
		await waitForLoginForm();
		fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'alice' } });
		fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

		await waitFor(() => {
			expect(authApi.completeSsoLogin).toHaveBeenCalledWith(sessionId);
			expect(document.write).toHaveBeenCalled();
		});
	});

	it('WEB-SAML-08: auto complete after login when samlSessionBound', async () => {
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
		await waitForLoginForm();
		fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'alice' } });
		fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

		await waitFor(() => {
			expect(authApi.completeSsoLogin).toHaveBeenCalledWith(sessionId);
		});
	});

	it('WEB-SAML-09: mount probe triggers complete when readyToComplete', async () => {
		const sessionId = 'clxxxxxxxxxxxxxxxxxxxxxxxxx';
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
			samlSession: {
				id: sessionId,
				bound: true,
				expired: false,
				spActive: true,
				readyToComplete: true,
			},
		});

		renderLogin(`/login?samlSessionId=${sessionId}`);
		await waitFor(() => {
			expect(authApi.completeSsoLogin).toHaveBeenCalledWith(sessionId);
		});
	});

	it('WEB-SAML-10: failed auto-complete shows error and manual Continue', async () => {
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
		vi.mocked(authApi.completeSsoLogin).mockRejectedValue(
			new authApi.AuthApiError(400, 'SAML session expired'),
		);

		renderLogin(`/login?samlSessionId=${sessionId}`);
		await waitForLoginForm();
		fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'alice' } });
		fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

		await waitFor(() => {
			expect(screen.getByRole('alert').textContent).toContain('SAML session expired');
			expect(screen.getByRole('button', { name: /Continue to application/i })).toBeDefined();
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
		await waitForLoginForm();
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

	it('WEB-AUTH-07: links back to admin console', async () => {
		renderLogin();
		await waitForLoginForm();
		const link = screen.getByRole('link', { name: 'Back to admin' });
		expect(link.getAttribute('href')).toBe('/admin');
	});

	it('WEB-EVG-07: renders Back to admin link (alias)', async () => {
		renderLogin();
		await waitForLoginForm();
		expect(screen.getByRole('link', { name: 'Back to admin' }).getAttribute('href')).toBe('/admin');
	});

	it('WEB-EVG-16 / LOGIN-GATE: renders a neutral notice Callout when there is no pending request', async () => {
		vi.mocked(authApi.getEndUserSession).mockResolvedValue({
			authenticated: false,
			user: null,
			samlSession: null,
		});

		renderLogin();
		await waitFor(() => {
			expect(screen.getByText(/through your application/i)).toBeDefined();
		});
	});
});
