import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot, webRoot } from '@test/helpers/paths';

describe('Evergreen infrastructure', () => {
	it('WEB-EVG-18: Playwright visual spec and config exist', () => {
		expect(existsSync(join(webRoot, 'playwright.config.ts'))).toBe(true);
		expect(existsSync(join(webRoot, 'e2e/evergreen-visual.spec.ts'))).toBe(true);
	});

	it('WEB-EVG-19: bundle size check script exists', () => {
		expect(existsSync(join(repoRoot, 'scripts/check-web-bundle-size.mjs'))).toBe(true);
	});

	it('WEB-EVG-71: bundle script enforces 700 KB budget constant', () => {
		const script = readFileSync(join(repoRoot, 'scripts/check-web-bundle-size.mjs'), 'utf8');
		expect(script).toContain('700 * 1024');
		expect(script).toContain('index-');
	});

	it('WEB-EVG-72: Playwright screenshot baselines are committed', () => {
		const shots = join(webRoot, 'e2e/screenshots');
		for (const name of [
			'admin-login-375.png',
			'admin-login-1280.png',
			'dashboard-375.png',
			'dashboard-1280.png',
			'api-connection-form-1280.png',
			'idp-settings-1280.png',
		]) {
			expect(existsSync(join(shots, name))).toBe(true);
		}
	});

	it('WEB-EVG-93: form and shell baselines including identity users list', () => {
		const shots = join(webRoot, 'e2e/screenshots');
		expect(existsSync(join(shots, 'api-connection-form-1280.png'))).toBe(true);
		expect(existsSync(join(shots, 'idp-settings-1280.png'))).toBe(true);
		expect(existsSync(join(shots, 'identity-users-list-1280.png'))).toBe(true);
	});

	it('WEB-EVG-94: evergreen-visual spec includes form page screenshots', () => {
		const spec = readFileSync(join(webRoot, 'e2e/evergreen-visual.spec.ts'), 'utf8');
		expect(spec).toContain('api-connection-form-1280.png');
		expect(spec).toContain('idp-settings-1280.png');
		expect(spec).toContain('identity-users-list-1280.png');
	});

	it('WEB-EVG-108: evergreen-ui.mmd documents Checkbox and Fieldset form primitives', () => {
		const mmd = readFileSync(join(repoRoot, 'docs/img/evergreen-ui.mmd'), 'utf8');
		expect(mmd).toContain('Checkbox');
		expect(mmd).toContain('Fieldset');
	});

	it('WEB-EVG-172: i18n login smoke spec and check-i18n-keys script exist', () => {
		expect(existsSync(join(webRoot, 'e2e/i18n-login-cs.spec.ts'))).toBe(true);
		expect(existsSync(join(repoRoot, 'scripts/check-i18n-keys.mjs'))).toBe(true);
	});

	it('WEB-EVG-173: extended i18n vitest suites exist', () => {
		const i18nTestDir = join(webRoot, 'test/unit/i18n');
		for (const name of [
			'i18n-edge-extended.test.ts',
			'i18n-key-parity.test.ts',
			'api-error-messages.test.ts',
			'enum-labels.test.ts',
			'i18n.integration.extended.test.tsx',
		]) {
			expect(existsSync(join(i18nTestDir, name))).toBe(true);
		}
	});

	it('WEB-EVG-174: responsive shell spec and vitest suites exist', () => {
		expect(existsSync(join(webRoot, 'e2e/responsive-shell.spec.ts'))).toBe(true);
		expect(existsSync(join(webRoot, 'test/unit/ui/app-shell-responsive.test.tsx'))).toBe(true);
		expect(existsSync(join(webRoot, 'test/unit/ui/responsive-layout-edge.test.ts'))).toBe(true);
	});

	it('WEB-EVG-175: proposal documents v1.3.2 responsive shell', () => {
		const proposal = readFileSync(join(repoRoot, 'docs/proposal.MD'), 'utf8');
		expect(proposal).toContain('v1.3.2');
		expect(proposal).toMatch(/responsive app shell|fixed sidebar/i);
	});

	it('WEB-EVG-176: admin-shell mobile drawer screenshot baseline', () => {
		expect(existsSync(join(webRoot, 'e2e/screenshots/admin-shell-375-drawer-open.png'))).toBe(true);
	});

	it('WEB-EVG-178: test:e2e:ci script runs responsive shell without screenshot test', () => {
		const pkg = readFileSync(join(webRoot, 'package.json'), 'utf8');
		expect(pkg).toContain('"test:e2e:ci"');
		expect(pkg).toContain('grep-invert WEB-RSP-31');
	});

	it('WEB-EVG-177: extended responsive shell vitest suites exist', () => {
		expect(existsSync(join(webRoot, 'test/unit/ui/responsive-shell-edge-extended.test.ts'))).toBe(true);
		expect(existsSync(join(webRoot, 'test/unit/ui/responsive-shell-edge-extended.test.tsx'))).toBe(true);
	});
});
