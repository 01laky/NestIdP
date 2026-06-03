import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = join(webRoot, '../..');

describe('Evergreen infrastructure', () => {
	it('WEB-EVG-18: Playwright visual spec and config exist', () => {
		expect(existsSync(join(webRoot, 'playwright.config.ts'))).toBe(true);
		expect(existsSync(join(webRoot, 'e2e/evergreen-visual.spec.ts'))).toBe(true);
	});

	it('WEB-EVG-19: bundle size check script exists', () => {
		expect(existsSync(join(repoRoot, 'scripts/check-web-bundle-size.mjs'))).toBe(true);
	});

	it('WEB-EVG-71: bundle script enforces 650 KB budget constant', () => {
		const script = readFileSync(join(repoRoot, 'scripts/check-web-bundle-size.mjs'), 'utf8');
		expect(script).toContain('650 * 1024');
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
		const i18nDir = join(webRoot, 'src/i18n');
		for (const name of [
			'i18n-edge-extended.test.ts',
			'i18n-key-parity.test.ts',
			'api-error-messages.test.ts',
			'enum-labels.test.ts',
			'i18n.integration.extended.test.tsx',
		]) {
			expect(existsSync(join(i18nDir, name))).toBe(true);
		}
	});
});
