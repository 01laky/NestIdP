import { describe, expect, it } from 'vitest';
import {
	BROWSER_LOCALE_SENTINEL,
	DEFAULT_LOCALE,
	LOCALE_STORAGE_KEY,
	SUPPORTED_LOCALES,
	isSupportedLocale,
} from './i18n.js';

describe('i18n constants (API-I18N-01–05)', () => {
	it('API-I18N-01: ten locales including cs and sk, default en', () => {
		expect(SUPPORTED_LOCALES).toHaveLength(10);
		expect(SUPPORTED_LOCALES).toContain('cs');
		expect(SUPPORTED_LOCALES).toContain('sk');
		expect(DEFAULT_LOCALE).toBe('en');
		expect(LOCALE_STORAGE_KEY).toBe('nestidp.locale');
		expect(BROWSER_LOCALE_SENTINEL).toBe('browser');
		expect(isSupportedLocale('en')).toBe(true);
		expect(isSupportedLocale('xx')).toBe(false);
	});

	it('API-I18N-02: locale list is stable and lowercase', () => {
		expect([...SUPPORTED_LOCALES]).toEqual([
			'en',
			'cs',
			'sk',
			'de',
			'fr',
			'es',
			'pl',
			'it',
			'pt',
			'nl',
		]);
		for (const code of SUPPORTED_LOCALES) {
			expect(code).toBe(code.toLowerCase());
		}
	});

	it('API-I18N-03: isSupportedLocale rejects empty and padded values', () => {
		expect(isSupportedLocale('')).toBe(false);
		expect(isSupportedLocale(' en ')).toBe(false);
		expect(isSupportedLocale('EN')).toBe(false);
	});

	it('API-I18N-04: cs and sk are distinct entries', () => {
		const csIndex = SUPPORTED_LOCALES.indexOf('cs');
		const skIndex = SUPPORTED_LOCALES.indexOf('sk');
		expect(csIndex).toBeGreaterThanOrEqual(0);
		expect(skIndex).toBeGreaterThanOrEqual(0);
		expect(csIndex).not.toBe(skIndex);
	});

	it('API-I18N-05: browser sentinel is not a supported locale code', () => {
		expect(isSupportedLocale(BROWSER_LOCALE_SENTINEL)).toBe(false);
		expect(BROWSER_LOCALE_SENTINEL).not.toEqual(DEFAULT_LOCALE);
	});
});
