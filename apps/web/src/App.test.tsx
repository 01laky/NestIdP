import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { AppRoutes } from './AppRoutes';

afterEach(() => {
	cleanup();
});

function renderAt(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<AppRoutes />
		</MemoryRouter>,
	);
}

describe('App routing', () => {
	it('renders admin placeholder at /admin', () => {
		renderAt('/admin');
		expect(screen.getByRole('heading', { name: 'NestIdP Admin' })).toBeDefined();
	});

	it('renders login placeholder at /login', () => {
		renderAt('/login');
		expect(screen.getByRole('heading', { name: 'SAML Login' })).toBeDefined();
	});

	it('redirects unknown paths to /admin', () => {
		renderAt('/unknown-route');
		expect(screen.getAllByRole('heading', { name: 'NestIdP Admin' }).length).toBe(1);
	});

	it('keeps admin and login as separate surfaces', () => {
		const { unmount } = renderAt('/admin');
		expect(screen.queryByRole('heading', { name: 'SAML Login' })).toBeNull();
		unmount();
		renderAt('/login');
		expect(screen.queryByRole('heading', { name: 'NestIdP Admin' })).toBeNull();
	});

	it('renders nested admin sub-routes without losing layout', () => {
		renderAt('/admin/api-connections');
		expect(screen.getAllByRole('heading', { name: 'NestIdP Admin' }).length).toBe(1);
		expect(screen.getByText(/Admin sub-route placeholder/)).toBeDefined();
	});

	it('redirects root path to /admin', () => {
		renderAt('/');
		expect(screen.getByRole('heading', { name: 'NestIdP Admin' })).toBeDefined();
	});

	it('does not expose API stub JSON in the UI', () => {
		renderAt('/admin');
		expect(screen.queryByText(/"status":\s*"stub"/)).toBeNull();
	});
});
