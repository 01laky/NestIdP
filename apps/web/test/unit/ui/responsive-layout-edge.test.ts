import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evergreenDir, repoRoot, webSrc } from '@test/helpers/paths';

const adminPages = join(webSrc, 'admin/pages');

function pageSource(name: string): string {
	return readFileSync(join(adminPages, name), 'utf8');
}

describe('Responsive layout edge guards (WEB-RSP)', () => {
	it('WEB-RSP-20: no permanent body overflow hidden in evergreen CSS', () => {
		for (const file of ['layout.css', 'components.css', 'reset.css', 'utilities.css']) {
			const css = readFileSync(join(evergreenDir, file), 'utf8');
			expect(css).not.toMatch(/(?:^|\n)body\s*\{[^}]*overflow:\s*hidden/);
		}
	});

	it('WEB-RSP-21: list/detail pages wrap Table in evg-table-wrap', () => {
		for (const file of [
			'ApiConnectionsListPage.tsx',
			'SpConnectionsListPage.tsx',
			'AuditLogPage.tsx',
			'AdminUsersPage.tsx',
			'IdentityGroupDetailPage.tsx',
			'IdentityRoleDetailPage.tsx',
		]) {
			const src = pageSource(file);
			expect(src).toContain('evg-table-wrap');
			expect(src).toContain('<Table');
		}
	});

	it('WEB-RSP-22: tokens define sidebar width and z-drawer', () => {
		const tokens = readFileSync(join(evergreenDir, 'tokens.css'), 'utf8');
		expect(tokens).toContain('--evg-sidebar-width');
		expect(tokens).toContain('--evg-z-drawer');
		expect(tokens).toContain('--evg-topbar-min-height');
	});

	it('WEB-RSP-23: evergreen-ui.mmd documents shell scroll model', () => {
		const mmd = readFileSync(join(repoRoot, 'docs/img/evergreen-ui.mmd'), 'utf8');
		expect(mmd).toMatch(/evg-shell-body|fixed sidebar|shell scroll/i);
	});

	it('WEB-RSP-24: page header row stacks under 639px', () => {
		const css = readFileSync(join(evergreenDir, 'components.css'), 'utf8');
		expect(css).toMatch(/@media \(max-width: 639px\)/);
		expect(css).toMatch(/\.evg-page-header__row[\s\S]*flex-direction:\s*column/);
	});

	it('WEB-RSP-25: evg-table-wrap has overflow-x auto', () => {
		const css = readFileSync(join(evergreenDir, 'components.css'), 'utf8');
		expect(css).toMatch(/\.evg-table-wrap\s*\{[^}]*overflow-x:\s*auto/);
	});

	it('WEB-RSP-26: evg-cluster uses flex-wrap for narrow toolbars', () => {
		const css = readFileSync(join(evergreenDir, 'utilities.css'), 'utf8');
		expect(css).toMatch(/\.evg-cluster\s*\{[^}]*flex-wrap:\s*wrap/);
	});

	it('WEB-RSP-28: mobile toast region inset below topbar', () => {
		const css = readFileSync(join(evergreenDir, 'components.css'), 'utf8');
		expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*\.evg-toast-region[\s\S]*top:/);
	});

	it('WEB-RSP-29: layout.css min-width 0 on shell-body', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toMatch(/\.evg-shell-body\s*\{[^}]*min-width:\s*0/);
	});

	it('WEB-RSP-36: SyncLogDetailPage exists with CodeBlock', () => {
		const src = pageSource('SyncLogDetailPage.tsx');
		expect(src).toContain('CodeBlock');
	});

	it('WEB-RSP-37: IdpSettingsPage exists for shell scroll QA', () => {
		expect(existsSync(join(adminPages, 'IdpSettingsPage.tsx'))).toBe(true);
	});

	it('WEB-RSP-38: proposal.MD documents v1.3.2 responsive shell', () => {
		const proposal = readFileSync(join(repoRoot, 'docs/proposal.MD'), 'utf8');
		expect(proposal).toMatch(/v1\.3\.2/);
		expect(proposal).toMatch(/sidebar|responsive shell/i);
	});

	it('WEB-RSP-39: development.md documents 769px edge and responsive-shell spec', () => {
		const dev = readFileSync(join(repoRoot, 'docs/development.md'), 'utf8');
		expect(dev).toContain('769');
		expect(dev).toContain('WEB-RSP-34');
		expect(dev).toContain('responsive-shell.spec.ts');
		expect(dev).toMatch(/WEB-RSP-01[`\u2013'-]+115/);
	});
});
