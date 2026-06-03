import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const webSrc = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(webSrc, '../../..');

const SCOPED_GLOBS = [
	'admin/pages',
	'admin/components',
	'login',
	'ui/AppShell.tsx',
	'ui/SidebarNav.tsx',
	'ui/OperatorSessionBar.tsx',
	'ui/MobileNavToggle.tsx',
];

const ALLOWLIST_SNIPPETS = [
	'NestIdP',
	'SAML',
	'Bearer',
	'HTTP-POST',
	'NameID',
	'Entity ID',
	'evg-',
	'import ',
	'from ',
	't(',
	'tCommon(',
	'tNav(',
	'resolveI18nKey',
	'formatAdminApiError',
	'formatAuthApiError',
	'useTranslation',
	'{{',
	'}}',
	'http',
	'.tsx',
	'JSON',
	'PEM',
	'SHA',
	'API',
	'SP ',
	'IdP',
	'SSO',
	'ACS',
	'CUID',
	'NEVER',
	'SUCCESS',
	'FAILED',
	'RUNNING',
	'true',
	'false',
	'—',
];

function looksLikeHardcodedEnglish(line: string): boolean {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) {
		return false;
	}
	if (
		!/>\s*[A-Za-z][^<{]*\s*</.test(trimmed) &&
		!/(title|label|subtitle|message|aria-label)=\{?['"][A-Za-z]/.test(trimmed)
	) {
		return false;
	}
	if (/async function|Promise<void>|<option value=/.test(trimmed)) {
		return false;
	}
	if (ALLOWLIST_SNIPPETS.some((snippet) => trimmed.includes(snippet))) {
		return false;
	}
	if (/>\s*[A-Za-z][^<{]*\s*</.test(trimmed)) {
		return true;
	}
	if (/(title|label|subtitle|message)=\{['"][A-Za-z][^'"]{3,}['"]\}/.test(trimmed)) {
		return true;
	}
	return false;
}

describe('i18n edge guards (WEB-I18N-29, 30, 40)', () => {
	it('WEB-I18N-29: no disallowed hardcoded English in scoped UI files', () => {
		const violations: string[] = [];
		for (const rel of SCOPED_GLOBS) {
			const full = join(webSrc, rel);
			const files = rel.endsWith('.tsx')
				? [full]
				: readdirSync(full)
						.filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
						.map((f) => join(full, f));
			for (const file of files) {
				const lines = readFileSync(file, 'utf8').split('\n');
				for (const line of lines) {
					if (looksLikeHardcodedEnglish(line)) {
						violations.push(`${file}: ${line.trim()}`);
					}
				}
			}
		}
		expect(violations).toEqual([]);
	});

	it('WEB-I18N-30: pnpm check:i18n-keys passes', () => {
		const out = execSync('pnpm check:i18n-keys', { cwd: repoRoot, encoding: 'utf8' });
		expect(out).toContain('i18n key parity OK');
	});

	it('WEB-I18N-40: locale JSON not inlined in main bundle', () => {
		execSync('pnpm --filter @nestidp/web build', { cwd: repoRoot, stdio: 'pipe' });
		const distAssets = join(repoRoot, 'apps/web/dist/assets');
		const jsFiles = readdirSync(distAssets).filter((f) => f.endsWith('.js'));
		const mainChunk = jsFiles.find((f) => f.startsWith('index-')) ?? jsFiles[0];
		const mainContent = readFileSync(join(distAssets, mainChunk), 'utf8');
		expect(mainContent).not.toContain('"usersTitle":"Groups"');
		const localeChunks = jsFiles.filter((f) => /^(cs|sk|de|fr|es|pl|it|pt|nl)-/.test(f));
		expect(localeChunks.length).toBeGreaterThanOrEqual(8);
	}, 120_000);
});
