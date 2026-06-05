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

beforeEach(() => {
	vi.spyOn(document, 'open').mockImplementation(() => window);
	vi.spyOn(document, 'write').mockImplementation(() => undefined);
	vi.spyOn(document, 'close').mockImplementation(() => undefined);
	vi.mocked(authApi.getEndUserSession).mockResolvedValue({
		authenticated: false,
		user: null,
		samlSession: null,
	});
});

function renderLogin(path = '/login') {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<LoginPage />
		</MemoryRouter>,
	);
}

async function waitForForm() {
	await waitFor(() => {
		expect(screen.getByRole('heading', { name: 'SAML Login' })).toBeDefined();
	});
}

describe('LoginPage Evergreen edge cases', () => {
	it('WEB-EVG-62: shows checking session loading state before form', () => {
		vi.mocked(authApi.getEndUserSession).mockImplementation(
			() =>
				new Promise(() => {
					/* pending */
				}),
		);
		renderLogin();
		expect(screen.getByText(/Checking session/i)).toBeDefined();
	});

	it('WEB-EVG-63: inactive SP shows warning callout on mount', async () => {
		vi.mocked(authApi.getEndUserSession).mockResolvedValue({
			authenticated: false,
			user: null,
			samlSession: {
				id: 'sess-1',
				bound: false,
				expired: false,
				spActive: false,
				readyToComplete: false,
			},
		});

		renderLogin('/login?samlSessionId=clxxxxxxxxxxxxxxxxxxxxxxxxx');
		await waitFor(() => {
			expect(screen.getByRole('status').textContent).toContain('inactive');
		});
	});

	it('WEB-EVG-64: login error uses danger Callout alert role', async () => {
		vi.mocked(authApi.loginEndUser).mockRejectedValue(
			new authApi.AuthApiError(401, 'Invalid username or password'),
		);

		renderLogin();
		await waitForForm();
		fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'bob' } });
		fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'x' } });
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

		await waitFor(() => {
			expect(screen.getByRole('alert').textContent).toContain('Invalid username');
		});
	});

	it('WEB-EVG-65: successful login without SAML shows success Callout', async () => {
		vi.mocked(authApi.loginEndUser).mockResolvedValue({
			ok: true,
			samlSessionBound: false,
			user: {
				id: 'u1',
				username: 'bob',
				email: null,
				displayName: null,
				groups: [],
				roles: [],
			},
		});

		renderLogin();
		await waitForForm();
		fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'bob' } });
		fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

		await waitFor(() => {
			const statuses = screen.getAllByRole('status');
			expect(statuses.some((n) => n.textContent?.includes('Signed in as bob'))).toBe(true);
		});
	});

	it('WEB-EVG-66: SSO redirect shows Spinner with status role after sign-in', async () => {
		const sessionId = 'clxxxxxxxxxxxxxxxxxxxxxxxxx';
		vi.mocked(authApi.loginEndUser).mockResolvedValue({
			ok: true,
			samlSessionBound: true,
			user: {
				id: 'u1',
				username: 'bob',
				email: null,
				displayName: null,
				groups: [],
				roles: [],
			},
		});
		vi.mocked(authApi.completeSsoLogin).mockImplementation(
			() =>
				new Promise(() => {
					/* never resolves — keep spinner visible */
				}),
		);

		renderLogin(`/login?samlSessionId=${sessionId}`);
		await waitForForm();
		fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'bob' } });
		fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret' } });
		fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

		await waitFor(() => {
			const statuses = screen.getAllByRole('status');
			expect(statuses.some((n) => /Redirecting/i.test(n.textContent ?? ''))).toBe(true);
		});
	});
});
