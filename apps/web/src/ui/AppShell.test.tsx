import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	AUDIT_ROUTE_PREFIX,
	API_CONNECTION_ROUTE_PREFIX,
	SP_CONNECTION_ROUTE_PREFIX,
} from '@nestidp/shared';
import { AppShell } from './AppShell';

afterEach(() => {
	cleanup();
});

describe('AppShell', () => {
	it('WEB-EVG-01: renders skip link and #evg-main', () => {
		render(
			<MemoryRouter>
				<AppShell operatorUsername="admin" onLogout={vi.fn()}>
					<p>Page body</p>
				</AppShell>
			</MemoryRouter>,
		);

		const skip = screen.getByRole('link', { name: 'Skip to content' });
		expect(skip.getAttribute('href')).toBe('#evg-main');
		expect(document.getElementById('evg-main')).toBeDefined();
		expect(screen.getByText('Page body')).toBeDefined();
	});

	it('WEB-EVG-02: mobile nav toggle opens drawer; Escape closes', () => {
		render(
			<MemoryRouter>
				<AppShell operatorUsername="admin" onLogout={vi.fn()}>
					<p>Content</p>
				</AppShell>
			</MemoryRouter>,
		);

		const sidebar = screen.getByTestId('evg-sidebar');
		expect(sidebar.className).not.toContain('evg-sidebar--open');

		fireEvent.click(screen.getByRole('button', { name: /menu/i }));
		expect(sidebar.className).toContain('evg-sidebar--open');

		fireEvent.keyDown(window, { key: 'Escape' });
		expect(sidebar.className).not.toContain('evg-sidebar--open');
	});

	it('WEB-EVG-54: drawer scrim click closes mobile menu', () => {
		render(
			<MemoryRouter>
				<AppShell operatorUsername="admin" onLogout={vi.fn()}>
					<p>Content</p>
				</AppShell>
			</MemoryRouter>,
		);
		fireEvent.click(screen.getByRole('button', { name: /menu/i }));
		expect(screen.getByTestId('evg-sidebar').className).toContain('evg-sidebar--open');
		fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
		expect(screen.getByTestId('evg-sidebar').className).not.toContain('evg-sidebar--open');
	});

	it('WEB-EVG-55: logout button invokes onLogout callback', () => {
		const onLogout = vi.fn();
		render(
			<MemoryRouter>
				<AppShell operatorUsername="admin" onLogout={onLogout}>
					<p>Content</p>
				</AppShell>
			</MemoryRouter>,
		);
		fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
		expect(onLogout).toHaveBeenCalledTimes(1);
	});

	it('WEB-EVG-56: mobile nav toggle exposes aria-expanded and controls sidebar', () => {
		render(
			<MemoryRouter>
				<AppShell operatorUsername={null} onLogout={vi.fn()}>
					<p>Content</p>
				</AppShell>
			</MemoryRouter>,
		);
		const toggle = screen.getByTestId('evg-mobile-nav-toggle');
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(toggle.getAttribute('aria-controls')).toBe('evg-sidebar');
		expect(screen.getByText('Operator console')).toBeDefined();
	});

	it('WEB-EVG-57: OperatorSessionBar change-password link targets hash anchor', () => {
		render(
			<MemoryRouter>
				<AppShell operatorUsername="operator" onLogout={vi.fn()}>
					<p>Content</p>
				</AppShell>
			</MemoryRouter>,
		);
		const links = screen.getAllByRole('link', { name: 'Change password' });
		expect(links.some((l) => l.getAttribute('href')?.includes('#change-password'))).toBe(true);
	});

	it('WEB-EVG-09: sidebar contains nav link hrefs for API, SP, and audit', () => {
		render(
			<MemoryRouter>
				<AppShell operatorUsername="admin" onLogout={vi.fn()}>
					<p>Content</p>
				</AppShell>
			</MemoryRouter>,
		);

		expect(screen.getByRole('link', { name: 'API connections' }).getAttribute('href')).toBe(
			API_CONNECTION_ROUTE_PREFIX,
		);
		expect(screen.getByRole('link', { name: 'SP connections' }).getAttribute('href')).toBe(
			SP_CONNECTION_ROUTE_PREFIX,
		);
		expect(screen.getByRole('link', { name: 'Audit log' }).getAttribute('href')).toBe(
			AUDIT_ROUTE_PREFIX,
		);
	});
});
