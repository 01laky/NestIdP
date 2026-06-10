import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evergreenDir, repoRoot, webRoot, webSrc } from '@test/helpers/paths';

const uiDir = join(webSrc, 'ui');
const adminPages = join(webSrc, 'admin/pages');
const screenshots = join(webRoot, 'e2e/screenshots');

function pageSource(name: string): string {
	return readFileSync(join(adminPages, name), 'utf8');
}

// The group/role detail pages are now thin wrappers over the shared `IdentityMemberDetailPage` component
// (Prompt 38 §A17); the table-wrap conventions live there, so resolve those wrappers to the component.
function pageOrSharedSource(name: string): string {
	if (name === 'IdentityGroupDetailPage.tsx' || name === 'IdentityRoleDetailPage.tsx') {
		return readFileSync(
			join(webSrc, 'admin/components/identity/IdentityMemberDetailPage.tsx'),
			'utf8',
		);
	}
	return pageSource(name);
}

function tableWrapBeforeTable(src: string): boolean {
	const wrapIdx = src.indexOf('evg-table-wrap');
	const tableIdx = src.indexOf('<Table');
	return wrapIdx !== -1 && tableIdx !== -1 && wrapIdx < tableIdx;
}

describe('Responsive shell — extended CSS and static guards (WEB-RSP-50–99)', () => {
	it('WEB-RSP-50: layout.css topbar min-width 0', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toMatch(/\.evg-topbar\s*\{[^}]*min-width:\s*0/);
	});

	it('WEB-RSP-51: layout.css main min-width 0', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toMatch(/\.evg-main\s*\{[^}]*min-width:\s*0/);
	});

	it('WEB-RSP-52: layout.css operator-bar min-width 0 and flex 1', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toMatch(/\.evg-operator-bar\s*\{[^}]*min-width:\s*0/);
		expect(layout).toMatch(/\.evg-operator-bar\s*\{[^}]*flex:\s*1/);
	});

	it('WEB-RSP-53: desktop shell-body overflow hidden', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toMatch(
			/@media \(min-width: 768px\)[\s\S]*\.evg-shell-body\s*\{[^}]*overflow:\s*hidden/,
		);
	});

	it('WEB-RSP-54: desktop sidebar sticky top 0', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toMatch(/@media \(min-width: 768px\)[\s\S]*\.evg-sidebar[\s\S]*top:\s*0/);
	});

	it('WEB-RSP-55: desktop sidebar align-self start', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toMatch(/align-self:\s*start/);
	});

	it('WEB-RSP-56: sidebar footer language select full width', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toMatch(/\.evg-sidebar-footer \.evg-language-select[\s\S]*width:\s*100%/);
	});

	it('WEB-RSP-57: drawer scrim z-index below drawer', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toMatch(/calc\(var\(--evg-z-drawer\) - 1\)/);
	});

	it('WEB-RSP-58: mobile sidebar width capped at 85vw', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toMatch(/width:\s*min\(280px,\s*85vw\)/);
	});

	it('WEB-RSP-59: prefers-reduced-motion disables sidebar transition', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toMatch(
			/prefers-reduced-motion:\s*reduce[\s\S]*\.evg-sidebar[\s\S]*transition:\s*none/,
		);
	});

	it('WEB-RSP-60: desktop grid uses sidebar width token', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toMatch(/grid-template-columns:\s*var\(--evg-sidebar-width\)/);
	});

	it('WEB-RSP-61: evg-container max-width 1200px', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toMatch(/\.evg-container\s*\{[^}]*max-width:\s*1200px/);
	});

	it('WEB-RSP-62: toast z-index above drawer in tokens', () => {
		const tokens = readFileSync(join(evergreenDir, 'tokens.css'), 'utf8');
		const drawer = tokens.match(/--evg-z-drawer:\s*(\d+)/)?.[1];
		const toast = tokens.match(/--evg-z-toast:\s*(\d+)/)?.[1];
		expect(Number(toast)).toBeGreaterThan(Number(drawer));
	});

	it('WEB-RSP-63: code-block max-width 100%', () => {
		const css = readFileSync(join(evergreenDir, 'components.css'), 'utf8');
		expect(css).toMatch(/\.evg-code-block\s*\{[^}]*max-width:\s*100%/);
	});

	it('WEB-RSP-64: page header buttons full width under 639px', () => {
		const css = readFileSync(join(evergreenDir, 'components.css'), 'utf8');
		expect(css).toMatch(/\.evg-page-header__row \.evg-btn[\s\S]*width:\s*100%/);
	});

	it('WEB-RSP-65: desktop toast region max-width 22rem', () => {
		const css = readFileSync(join(evergreenDir, 'components.css'), 'utf8');
		expect(css).toMatch(
			/@media \(min-width: 768px\)[\s\S]*\.evg-toast-region[\s\S]*max-width:\s*22rem/,
		);
	});

	it('WEB-RSP-66: identity list pages use IdentityListTable with table wrap', () => {
		const tableSrc = readFileSync(
			join(webSrc, 'admin/components/identity/IdentityListTable.tsx'),
			'utf8',
		);
		expect(tableSrc).toContain('IdentityListTable');
		expect(tableSrc).toMatch(/<Table[\s>]/);
		for (const file of [
			'IdentityUsersPage.tsx',
			'IdentityGroupsPage.tsx',
			'IdentityRolesPage.tsx',
		]) {
			expect(pageSource(file)).toContain('IdentityListTable');
		}
	});

	it('WEB-RSP-67: ApiConnectionsListPage wrap precedes Table', () => {
		expect(tableWrapBeforeTable(pageSource('ApiConnectionsListPage.tsx'))).toBe(true);
	});

	it('WEB-RSP-68: SpConnectionsListPage wrap precedes Table', () => {
		expect(tableWrapBeforeTable(pageSource('SpConnectionsListPage.tsx'))).toBe(true);
	});

	it('WEB-RSP-69: AuditLogPage wrap precedes Table', () => {
		expect(tableWrapBeforeTable(pageSource('AuditLogPage.tsx'))).toBe(true);
	});

	it('WEB-RSP-70: AdminUsersPage wrap precedes Table', () => {
		expect(tableWrapBeforeTable(pageSource('AdminUsersPage.tsx'))).toBe(true);
	});

	it('WEB-RSP-71: identity detail pages wrap member tables', () => {
		for (const file of ['IdentityGroupDetailPage.tsx', 'IdentityRoleDetailPage.tsx']) {
			expect(tableWrapBeforeTable(pageOrSharedSource(file))).toBe(true);
		}
	});

	it('WEB-RSP-72: nine admin pages use evg-table-wrap with Table', () => {
		const wrappedWithLocalWrap = [
			'ApiConnectionsListPage.tsx',
			'SpConnectionsListPage.tsx',
			'AuditLogPage.tsx',
			'AdminUsersPage.tsx',
			'IdentityGroupDetailPage.tsx',
			'IdentityRoleDetailPage.tsx',
		];
		const wrappedViaListTable = [
			'IdentityUsersPage.tsx',
			'IdentityGroupsPage.tsx',
			'IdentityRolesPage.tsx',
		];
		expect(wrappedWithLocalWrap.length + wrappedViaListTable.length).toBe(9);
		for (const file of wrappedWithLocalWrap) {
			expect(pageOrSharedSource(file)).toContain('evg-table-wrap');
		}
		for (const file of wrappedViaListTable) {
			expect(pageSource(file)).toContain('createLazyIdentityListTable');
		}
	});

	it('WEB-RSP-73: AdminLayout registers sync and idp routes', () => {
		const src = readFileSync(join(webRoot, 'src/admin/AdminLayout.tsx'), 'utf8');
		expect(src).toContain('api-connections/:id/sync');
		expect(src).toContain('sync-logs/:syncLogId');
		expect(src).toContain('settings/idp');
	});

	it('WEB-RSP-74: SpConnectionsListPage uses AdminPageHeader', () => {
		expect(pageSource('SpConnectionsListPage.tsx')).toContain('AdminPageHeader');
	});

	it('WEB-RSP-75: ApiConnectionsListPage uses AdminPageHeader', () => {
		expect(pageSource('ApiConnectionsListPage.tsx')).toContain('AdminPageHeader');
	});

	it('WEB-RSP-76: responsive-shell.spec declares WEB-RSP-30 through 34', () => {
		const spec = readFileSync(join(webRoot, 'e2e/responsive-shell.spec.ts'), 'utf8');
		for (const id of ['30', '31', '32', '33', '34']) {
			expect(spec).toContain(`WEB-RSP-${id}`);
		}
	});

	it('WEB-RSP-77: responsive-shell spec sets en locale init script', () => {
		const spec = readFileSync(join(webRoot, 'e2e/responsive-shell.spec.ts'), 'utf8');
		expect(spec).toContain("localStorage.setItem('nestidp.locale', 'en')");
	});

	it('WEB-RSP-78: admin-shell drawer screenshot committed', () => {
		expect(existsSync(join(screenshots, 'admin-shell-375-drawer-open.png'))).toBe(true);
	});

	it('WEB-RSP-79: dashboard-1280 screenshot committed', () => {
		expect(existsSync(join(screenshots, 'dashboard-1280.png'))).toBe(true);
	});

	it('WEB-RSP-80: idp-settings-1280 screenshot committed', () => {
		expect(existsSync(join(screenshots, 'idp-settings-1280.png'))).toBe(true);
	});

	it('WEB-RSP-81: CHANGELOG documents WEB-RSP and dev docker hot reload', () => {
		const changelog = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8');
		expect(changelog).toContain('## [1.3.4]');
		expect(changelog).toMatch(/WEB-RSP/);
		expect(changelog).toMatch(/dev:docker|hot reload/i);
	});

	it('WEB-RSP-82: root package.json has semver version', () => {
		const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
		expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
	});

	it('WEB-RSP-83: web version matches monorepo root', () => {
		const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
		const webPkg = JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8'));
		expect(webPkg.version).toBe(rootPkg.version);
	});

	it('WEB-RSP-84: root package.json defines docker:dev scripts', () => {
		const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
		expect(pkg.scripts['docker:dev']).toContain('docker-compose.dev.yml');
		expect(pkg.scripts['docker:dev:down']).toBeDefined();
	});

	it('WEB-RSP-84b: docker dev compose and Dockerfile.dev exist', () => {
		expect(existsSync(join(repoRoot, 'deploy/docker-compose.dev.yml'))).toBe(true);
		expect(existsSync(join(repoRoot, 'Dockerfile.dev'))).toBe(true);
		expect(existsSync(join(repoRoot, 'scripts/docker-dev-entrypoint.sh'))).toBe(true);
	});

	it('WEB-RSP-85: core responsive vitest files exist', () => {
		for (const name of [
			'app-shell-responsive.test.tsx',
			'responsive-layout-edge.test.ts',
			'responsive-shell-edge-extended.test.tsx',
			'responsive-shell-edge-extended.test.ts',
		]) {
			expect(existsSync(join(webRoot, 'test/unit/ui', name))).toBe(true);
		}
	});

	it('WEB-RSP-86: print.css hides sidebar with display none important', () => {
		const printCss = readFileSync(join(evergreenDir, 'print.css'), 'utf8');
		expect(printCss).toMatch(/\.evg-sidebar[\s\S]*display:\s*none\s*!important/);
	});

	it('WEB-RSP-87: print.css hides drawer scrim', () => {
		const printCss = readFileSync(join(evergreenDir, 'print.css'), 'utf8');
		expect(printCss).toContain('.evg-drawer-scrim');
	});

	it('WEB-RSP-88: MobileNavToggle uses evg-mobile-nav-toggle class', () => {
		const src = readFileSync(join(uiDir, 'MobileNavToggle.tsx'), 'utf8');
		expect(src).toContain('evg-mobile-nav-toggle');
		expect(src).toContain('aria-controls="evg-sidebar"');
	});

	it('WEB-RSP-89: development.md lists WEB-RSP-01 through 115 registry', () => {
		const dev = readFileSync(join(repoRoot, 'docs/development.md'), 'utf8');
		expect(dev).toContain('WEB-RSP-01');
		expect(dev).toMatch(/WEB-RSP-01[`\u2013'-]+115/);
	});

	it('WEB-RSP-90: evergreen-ui.svg exists after shell diagram', () => {
		expect(existsSync(join(repoRoot, 'docs/img/evergreen-ui.svg'))).toBe(true);
		const svg = readFileSync(join(repoRoot, 'docs/img/evergreen-ui.svg'), 'utf8');
		expect(svg.length).toBeGreaterThan(100);
	});

	it('WEB-RSP-91: layout topbar flex-shrink 0', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toMatch(/\.evg-topbar\s*\{[^}]*flex-shrink:\s*0/);
	});

	it('WEB-RSP-92: mobile drawer translateX off-canvas default', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toMatch(/translateX\(-100%\)/);
	});

	it('WEB-RSP-93: open drawer translateX zero', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toMatch(/\.evg-sidebar--open[\s\S]*translateX\(0\)/);
	});

	it('WEB-RSP-94: table-wrap touch scrolling', () => {
		const css = readFileSync(join(evergreenDir, 'components.css'), 'utf8');
		expect(css).toMatch(/\.evg-table-wrap[\s\S]*-webkit-overflow-scrolling:\s*touch/);
	});

	it('WEB-RSP-95: AppShell uses evg-shell-body className not bare div', () => {
		const src = readFileSync(join(uiDir, 'AppShell.tsx'), 'utf8');
		expect(src).toContain('className="evg-shell-body"');
		expect(src).not.toMatch(/<div>\s*\n\s*<header className="evg-topbar">/);
	});

	it('WEB-RSP-96: SyncLogDetailPage route param syncLogId', () => {
		const src = pageSource('SyncLogDetailPage.tsx');
		expect(src).toContain('syncLogId');
	});

	it('WEB-RSP-97: ApiConnectionSyncPage registered in AdminLayout', () => {
		const src = readFileSync(join(webRoot, 'src/admin/AdminLayout.tsx'), 'utf8');
		expect(src).toContain('ApiConnectionSyncPage');
	});

	it('WEB-RSP-98: identity inline form stacks at 480px in components', () => {
		const css = readFileSync(join(evergreenDir, 'components.css'), 'utf8');
		expect(css).toMatch(/@media \(max-width: 480px\)[\s\S]*\.evg-inline-form/);
	});

	it('WEB-RSP-99: shell breakpoint pair 767 mobile and 768 desktop', () => {
		const layout = readFileSync(join(evergreenDir, 'layout.css'), 'utf8');
		expect(layout).toContain('max-width: 767px');
		expect(layout).toContain('min-width: 768px');
	});
});
