import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { IDENTITY_ROUTE_PREFIX } from '@nestidp/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { IdentitySectionNav } from '@/admin/components/identity/IdentitySectionNav';

afterEach(() => {
	cleanup();
});

describe('IdentitySectionNav', () => {
	it('WEB-IDN-UI-45: users current omits Users link', () => {
		render(
			<MemoryRouter>
				<IdentitySectionNav current="users" />
			</MemoryRouter>,
		);
		expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
		expect(screen.getByRole('link', { name: 'Groups' })).toBeDefined();
		expect(screen.getByRole('link', { name: 'Roles' })).toBeDefined();
	});

	it('WEB-IDN-UI-46: groups current links Users and Roles only', () => {
		render(
			<MemoryRouter>
				<IdentitySectionNav current="groups" />
			</MemoryRouter>,
		);
		expect(screen.getByRole('link', { name: 'Users' }).getAttribute('href')).toBe(
			`${IDENTITY_ROUTE_PREFIX}/users`,
		);
		expect(screen.queryByRole('link', { name: 'Groups' })).toBeNull();
		expect(screen.getByRole('link', { name: 'Roles' }).className).toContain('evg-btn--link');
	});

	it('WEB-IDN-UI-58: roles current and nav aria-label', () => {
		const { container } = render(
			<MemoryRouter>
				<IdentitySectionNav current="roles" />
			</MemoryRouter>,
		);
		const nav = container.querySelector('nav.evg-identity-section-nav');
		expect(nav?.getAttribute('aria-label')).toBe('Identity sections');
		expect(screen.getByRole('link', { name: 'Users' })).toBeDefined();
		expect(screen.getByRole('link', { name: 'Groups' })).toBeDefined();
		expect(screen.queryByRole('link', { name: 'Roles' })).toBeNull();
	});
});
