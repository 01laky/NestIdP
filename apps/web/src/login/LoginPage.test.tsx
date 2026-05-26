import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { LoginPage } from './LoginPage';

afterEach(() => {
	cleanup();
});

function renderLogin() {
	return render(
		<MemoryRouter>
			<LoginPage />
		</MemoryRouter>,
	);
}

describe('LoginPage', () => {
	it('renders SAML login heading', () => {
		renderLogin();
		expect(screen.getByRole('heading', { name: 'SAML Login' })).toBeDefined();
	});

	it('renders disabled username and password fields as stubs', () => {
		renderLogin();
		const username = screen.getByLabelText(/Username/i) as HTMLInputElement;
		const password = screen.getByLabelText(/Password/i) as HTMLInputElement;
		expect(username.disabled).toBe(true);
		expect(password.disabled).toBe(true);
		expect(password.type).toBe('password');
		expect(username.placeholder).toBe('Coming soon');
		expect(password.placeholder).toBe('Coming soon');
	});

	it('renders disabled submit button', () => {
		renderLogin();
		const button = screen.getByRole('button', { name: /Sign in \(stub\)/i }) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
	});

	it('prevents default form submission', () => {
		renderLogin();
		const form = screen.getByRole('button', { name: /Sign in \(stub\)/i }).closest('form');
		expect(form).not.toBeNull();
		const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
		const prevented = !form!.dispatchEvent(submitEvent);
		expect(prevented).toBe(true);
	});

	it('does not submit when form submit event fires', () => {
		renderLogin();
		const form = screen.getByRole('button', { name: /Sign in \(stub\)/i }).closest('form')!;
		fireEvent.submit(form);
		expect(screen.getByRole('heading', { name: 'SAML Login' })).toBeDefined();
	});

	it('links back to admin console', () => {
		renderLogin();
		const link = screen.getByRole('link', { name: 'Back to admin' });
		expect(link.getAttribute('href')).toBe('/admin');
	});

	it('does not render admin layout heading', () => {
		renderLogin();
		expect(screen.queryByRole('heading', { name: 'NestIdP Admin' })).toBeNull();
	});
});
