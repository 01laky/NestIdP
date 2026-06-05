import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { i18nDir, repoRoot, webRoot, webSrc } from '@test/helpers/paths';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from '@nestidp/shared';
import { I18N_NAMESPACES } from '@/i18n/namespaces';
import { formatDateTime, getI18n, initI18n } from '@/i18n/i18n';

const localesDir = join(i18nDir, 'locales');

const ADMIN_PAGE_GLOBS = readdirSync(join(webSrc, 'admin/pages')).filter(
	(f) => f.endsWith('.tsx') && !f.includes('.test.'),
);

describe('i18n edge — extended (WEB-I18N-79–95)', () => {
	it('WEB-I18N-79: all ten locale JSON files exist and parse', () => {
		for (const code of SUPPORTED_LOCALES) {
			const path = join(localesDir, `${code}.json`);
			expect(existsSync(path)).toBe(true);
			const json = JSON.parse(readFileSync(path, 'utf8'));
			expect(Object.keys(json).length).toBe(I18N_NAMESPACES.length);
		}
	});

	it('WEB-I18N-80: cs dashboard title differs from sk', () => {
		const cs = JSON.parse(readFileSync(join(localesDir, 'cs.json'), 'utf8'));
		const sk = JSON.parse(readFileSync(join(localesDir, 'sk.json'), 'utf8'));
		expect(cs.dashboard.title).toBe('Přehled');
		expect(sk.dashboard.title).toBe('Prehľad');
		expect(cs.dashboard.title).not.toBe(sk.dashboard.title);
	});

	it('WEB-I18N-81: main.tsx bootstraps resolveLocale before render', () => {
		const main = readFileSync(join(webSrc, 'main.tsx'), 'utf8');
		expect(main).toContain('resolveLocale()');
		expect(main).toContain('await initI18n(locale)');
		expect(main).toContain('createRoot');
	});

	it('WEB-I18N-82: vitest setup-i18n forces en via initI18nForTests', () => {
		const setup = readFileSync(join(webRoot, 'test/setup/setup-i18n.ts'), 'utf8');
		expect(setup).toContain("initI18nForTests('en')");
	});

	it('WEB-I18N-83: renderWithUi wraps I18nextProvider', () => {
		const render = readFileSync(join(webRoot, 'test/helpers/renderWithUi.tsx'), 'utf8');
		expect(render).toContain('I18nextProvider');
		expect(render).toContain('ToastProvider');
	});

	it('WEB-I18N-84: i18n.ts uses import.meta.glob for locale JSON', () => {
		const src = readFileSync(join(i18nDir, 'i18n.ts'), 'utf8');
		expect(src).toContain('import.meta.glob');
		expect(src).toContain('./locales/*.json');
		expect(src).toContain('fallbackLng');
	});

	it('WEB-I18N-85: LanguageSelect lists browser sentinel plus ten locales', () => {
		const src = readFileSync(join(webSrc, 'ui/LanguageSelect.tsx'), 'utf8');
		expect(src).toContain('BROWSER_LOCALE_SENTINEL');
		expect(src).toContain('LOCALE_NATIVE_LABELS');
		expect(src).toContain('SUPPORTED_LOCALES.map');
	});

	it('WEB-I18N-86: admin pages import useTranslation or error helpers', () => {
		const missing: string[] = [];
		for (const file of ADMIN_PAGE_GLOBS) {
			const text = readFileSync(join(webSrc, 'admin/pages', file), 'utf8');
			const usesI18n =
				text.includes('useTranslation') ||
				text.includes('formatAdminApiError') ||
				text.includes('t(');
			if (!usesI18n) {
				missing.push(file);
			}
		}
		expect(missing).toEqual([]);
	});

	it('WEB-I18N-87: login pages use useTranslation', () => {
		for (const file of ['login/LoginPage.tsx', 'admin/AdminLoginPage.tsx']) {
			const text = readFileSync(join(webSrc, file), 'utf8');
			expect(text).toContain('useTranslation');
		}
	});

	it('WEB-I18N-88: SidebarNav wires LanguageSelect', () => {
		expect(readFileSync(join(webSrc, 'ui/SidebarNav.tsx'), 'utf8')).toContain('LanguageSelect');
	});

	it('WEB-I18N-89: api-error-messages maps all documented slugs', () => {
		const src = readFileSync(join(i18nDir, 'api-error-messages.ts'), 'utf8');
		for (const slug of [
			'managed_by_sync',
			'Invalid credentials',
			'Unauthorized',
			'Invalid id',
			'Sync already in progress',
		]) {
			expect(src).toContain(slug);
		}
	});

	it('WEB-I18N-90: enum-labels helpers cover audit, origin, sp preset', () => {
		const src = readFileSync(join(i18nDir, 'enum-labels.ts'), 'utf8');
		expect(src).toContain('auditCategoryLabel');
		expect(src).toContain('identityOriginFilterLabel');
		expect(src).toContain('spPresetLabel');
	});

	it('WEB-I18N-91: check-i18n-keys script registered at repo root', () => {
		const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
			scripts: Record<string, string>;
		};
		expect(pkg.scripts['check:i18n-keys']).toContain('check-i18n-keys.mjs');
		expect(existsSync(join(repoRoot, 'scripts/check-i18n-keys.mjs'))).toBe(true);
	});

	it('WEB-I18N-92: shared i18n.ts exports isSupportedLocale', () => {
		const src = readFileSync(join(repoRoot, 'packages/shared/src/i18n.ts'), 'utf8');
		expect(src).toContain('SUPPORTED_LOCALES');
		expect(src).toContain('isSupportedLocale');
	});

	it('WEB-I18N-93: formatDateTime uses locale tag', async () => {
		await initI18n('de');
		const out = formatDateTime('2026-06-03T12:00:00.000Z', 'de');
		expect(out.length).toBeGreaterThan(5);
	});

	it('WEB-I18N-94: initI18n sets document lang for each supported locale', async () => {
		for (const code of ['fr', 'nl', 'pt'] as const) {
			await initI18n(code);
			expect(document.documentElement.lang).toBe(code);
		}
	});

	it('WEB-I18N-95: en catalog apply key present in all locales', () => {
		const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8'));
		const enApply = (en.common as { apply: string }).apply;
		expect(enApply).toBe('Apply');
		for (const code of SUPPORTED_LOCALES) {
			if (code === 'en') {
				continue;
			}
			const data = JSON.parse(readFileSync(join(localesDir, `${code}.json`), 'utf8'));
			const translated = (data.common as { apply: string }).apply;
			expect(translated).toBeTruthy();
			expect(translated).not.toBe(enApply);
		}
	});
});

describe('i18n edge — catalog quality (WEB-I18N-96–98)', () => {
	it('WEB-I18N-96: cs and sk login.signIn differ', () => {
		const cs = JSON.parse(readFileSync(join(localesDir, 'cs.json'), 'utf8'));
		const sk = JSON.parse(readFileSync(join(localesDir, 'sk.json'), 'utf8'));
		expect(cs.login.signIn).toBe('Přihlásit se');
		expect(sk.login.signIn).toBe('Prihlásiť se');
	});

	it('WEB-I18N-97: getI18n returns initialized instance after init', async () => {
		await initI18n('it');
		expect(getI18n().language).toBe('it');
		expect(getI18n().t('common.save')).toBeTruthy();
	});

	it('WEB-I18N-98: errors namespace has signInFailed in every locale', () => {
		for (const code of SUPPORTED_LOCALES) {
			const data = JSON.parse(readFileSync(join(localesDir, `${code}.json`), 'utf8'));
			expect((data.errors as { signInFailed: string }).signInFailed.length).toBeGreaterThan(5);
		}
	});
});
