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

	it('WEB-EVG-71: bundle script enforces 500 KB budget constant', () => {
		const script = readFileSync(join(repoRoot, 'scripts/check-web-bundle-size.mjs'), 'utf8');
		expect(script).toContain('500 * 1024');
		expect(script).toContain('index-');
	});

	it('WEB-EVG-72: four Playwright screenshot baselines are committed', () => {
		const shots = join(webRoot, 'e2e/screenshots');
		for (const name of [
			'admin-login-375.png',
			'admin-login-1280.png',
			'dashboard-375.png',
			'dashboard-1280.png',
		]) {
			expect(existsSync(join(shots, name))).toBe(true);
		}
	});
});
