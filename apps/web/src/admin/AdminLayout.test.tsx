import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { API_CONNECTION_ROUTE_PREFIX, SP_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminLayout } from './AdminLayout';

afterEach(() => {
	cleanup();
});

function renderAdminAt(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/admin/*" element={<AdminLayout />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('AdminLayout', () => {
	it('renders admin heading and dashboard placeholder at /admin', () => {
		renderAdminAt('/admin');
		expect(screen.getByRole('heading', { name: 'NestIdP Admin' })).toBeDefined();
		expect(screen.getByText(/Dashboard placeholder/)).toBeDefined();
	});

	it('shows separate API and SP connection route prefixes', () => {
		renderAdminAt('/admin');
		expect(screen.getByText(API_CONNECTION_ROUTE_PREFIX)).toBeDefined();
		expect(screen.getByText(SP_CONNECTION_ROUTE_PREFIX)).toBeDefined();
	});

	it('keeps API and SP prefixes distinct in UI', () => {
		renderAdminAt('/admin');
		expect(API_CONNECTION_ROUTE_PREFIX).not.toBe(SP_CONNECTION_ROUTE_PREFIX);
		expect(screen.getByText(/api-connections/)).toBeDefined();
		expect(screen.getByText(/sp-connections/)).toBeDefined();
	});

	it('renders sub-route placeholder for nested admin paths', () => {
		renderAdminAt('/admin/api-connections');
		expect(screen.getByText(/Admin sub-route placeholder/)).toBeDefined();
	});

	it('renders sub-route placeholder for deep nested paths', () => {
		renderAdminAt('/admin/sp-connections/new');
		expect(screen.getByText(/Admin sub-route placeholder/)).toBeDefined();
	});

	it('links to SAML login page', () => {
		renderAdminAt('/admin');
		const link = screen.getByRole('link', { name: 'Go to SAML login page' });
		expect(link.getAttribute('href')).toBe('/login');
	});

	it('does not render login page heading', () => {
		renderAdminAt('/admin');
		expect(screen.queryByRole('heading', { name: 'SAML Login' })).toBeNull();
	});
});
