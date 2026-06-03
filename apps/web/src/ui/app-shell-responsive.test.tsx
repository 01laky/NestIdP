import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';

const evergreenDir = join(dirname(fileURLToPath(import.meta.url)), '../styles/evergreen');

function renderShell() {
	return render(
		<MemoryRouter>
			<AppShell operatorUsername="admin" onLogout={vi.fn()}>
				<p>Page body</p>
			</AppShell>
		</MemoryRouter>,
	);
}

afterEach(() => {
	cleanup();
	document.body.style.overflow = '';
});

describe('Responsive app shell (WEB-RSP)', () => {
	it('WEB-RSP-01: layout.css shell uses 100dvh/100vh and overflow hidden on desktop shell', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toMatch(/100dvh/);
		expect(layout).toMatch(/100vh/);
		expect(layout).toMatch(/overflow:\s*hidden/);
	});

	it('WEB-RSP-02: layout.css desktop MQ sticky sidebar and main overflow-y auto', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toMatch(/@media \(min-width: 768px\)/);
		expect(layout).toMatch(/position:\s*sticky/);
		expect(layout).toMatch(/\.evg-main[\s\S]*overflow-y:\s*auto/);
	});

	it('WEB-RSP-03: layout.css hides mobile nav toggle by default, shows under 767px', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toMatch(/\.evg-mobile-nav-toggle\s*\{[^}]*display:\s*none\s*!important/);
		expect(layout).toMatch(
			/@media \(max-width: 767px\)[\s\S]*\.evg-mobile-nav-toggle[\s\S]*display:\s*inline-flex\s*!important/,
		);
	});

	it('WEB-RSP-04: AppShell renders evg-shell-body wrapper', () => {
		const { container } = renderShell();
		expect(container.querySelector('.evg-shell-body')).not.toBeNull();
	});

	it('WEB-RSP-14: drawer scrim not rendered when drawer closed', () => {
		const { container } = renderShell();
		expect(container.querySelector('.evg-drawer-scrim')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: /menu/i }));
		expect(container.querySelector('.evg-drawer-scrim')).not.toBeNull();
	});

	it('WEB-RSP-15: quadruple burger toggle ends closed', () => {
		renderShell();
		const sidebar = screen.getByTestId('evg-sidebar');
		const toggle = screen.getByRole('button', { name: /menu/i });
		fireEvent.click(toggle);
		fireEvent.click(toggle);
		fireEvent.click(toggle);
		fireEvent.click(toggle);
		expect(sidebar.className).not.toContain('evg-sidebar--open');
	});

	it('WEB-RSP-16: unmount clears body overflow when drawer was open', () => {
		const { unmount } = renderShell();
		fireEvent.click(screen.getByRole('button', { name: /menu/i }));
		expect(document.body.style.overflow).toBe('hidden');
		unmount();
		expect(document.body.style.overflow).toBe('');
	});

	it('WEB-RSP-17: inert and aria-hidden cleared when drawer closes', () => {
		renderShell();
		const main = document.getElementById('evg-main');
		const toggle = screen.getByRole('button', { name: /menu/i });
		fireEvent.click(toggle);
		expect(main?.hasAttribute('inert')).toBe(true);
		fireEvent.click(toggle);
		expect(main?.hasAttribute('inert')).toBe(false);
		expect(main?.getAttribute('aria-hidden')).toBeNull();
	});

	it('WEB-RSP-18: skip link targets evg-main while drawer open', () => {
		renderShell();
		fireEvent.click(screen.getByRole('button', { name: /menu/i }));
		expect(screen.getByRole('link', { name: 'Skip to content' }).getAttribute('href')).toBe(
			'#evg-main',
		);
	});

	it('WEB-RSP-19: main wraps children in evg-container', () => {
		const { container } = renderShell();
		const main = container.querySelector('#evg-main');
		expect(main?.querySelector('.evg-container')?.textContent).toContain('Page body');
	});

	it('WEB-RSP-05: burger toggles evg-sidebar--open (see WEB-EVG-02)', () => {
		renderShell();
		const sidebar = screen.getByTestId('evg-sidebar');
		fireEvent.click(screen.getByRole('button', { name: /menu/i }));
		expect(sidebar.className).toContain('evg-sidebar--open');
	});

	it('WEB-RSP-06: Escape closes drawer', () => {
		renderShell();
		const sidebar = screen.getByTestId('evg-sidebar');
		fireEvent.click(screen.getByRole('button', { name: /menu/i }));
		fireEvent.keyDown(window, { key: 'Escape' });
		expect(sidebar.className).not.toContain('evg-sidebar--open');
	});

	it('WEB-RSP-07: scrim click closes drawer', () => {
		renderShell();
		const sidebar = screen.getByTestId('evg-sidebar');
		fireEvent.click(screen.getByRole('button', { name: /menu/i }));
		fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
		expect(sidebar.className).not.toContain('evg-sidebar--open');
	});

	it('WEB-RSP-08: aria-expanded toggles on burger', () => {
		renderShell();
		const toggle = screen.getByTestId('evg-mobile-nav-toggle');
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		fireEvent.click(toggle);
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		fireEvent.click(toggle);
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
	});

	it('WEB-RSP-09: SidebarNav onNavigate closes drawer', () => {
		renderShell();
		const sidebar = screen.getByTestId('evg-sidebar');
		fireEvent.click(screen.getByRole('button', { name: /menu/i }));
		expect(sidebar.className).toContain('evg-sidebar--open');
		fireEvent.click(screen.getByRole('link', { name: 'Audit log' }));
		expect(sidebar.className).not.toContain('evg-sidebar--open');
	});

	it('WEB-RSP-10: body scroll lock when drawer open', () => {
		renderShell();
		expect(document.body.style.overflow).not.toBe('hidden');
		fireEvent.click(screen.getByRole('button', { name: /menu/i }));
		expect(document.body.style.overflow).toBe('hidden');
		fireEvent.keyDown(window, { key: 'Escape' });
		expect(document.body.style.overflow).toBe('');
	});

	it('WEB-RSP-11: print.css hides sidebar and mobile toggle', () => {
		const printCss = readFileSync(join(evergreenDir, 'print.css'), 'utf8');
		expect(printCss).toContain('.evg-sidebar');
		expect(printCss).toContain('.evg-mobile-nav-toggle');
	});

	it('WEB-RSP-12: layout.css resets sidebar transform at min-width 768px', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toMatch(/@media \(min-width: 768px\)[\s\S]*transform:\s*none/);
	});

	it('WEB-RSP-13: AppShell listens for desktop matchMedia to close drawer', () => {
		const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'AppShell.tsx'), 'utf8');
		expect(src).toContain('matchMedia');
		expect(src).toContain('768');
	});

	it('WEB-RSP-27: main is inert and aria-hidden when drawer open', () => {
		renderShell();
		const main = document.getElementById('evg-main');
		expect(main?.hasAttribute('inert')).toBe(false);
		expect(main?.getAttribute('aria-hidden')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: /menu/i }));
		expect(main?.hasAttribute('inert')).toBe(true);
		expect(main?.getAttribute('aria-hidden')).toBe('true');
	});
});
