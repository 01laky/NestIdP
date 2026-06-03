import { LOCALE_STORAGE_KEY, SUPPORTED_LOCALES } from '@nestidp/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	clearStoredLocale,
	normalizeBrowserTag,
	readStoredLocale,
	resolveDisplayLocale,
	resolveLocale,
	tagToSupportedLocale,
} from './resolve-locale';

describe('resolveLocale (WEB-I18N-01–08)', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		localStorage.clear();
	});

	it('WEB-I18N-01: sk-SK → sk', () => {
		expect(resolveLocale({ browserLanguages: ['sk-SK', 'en'] })).toBe('sk');
	});

	it('WEB-I18N-02: cs-CZ → cs', () => {
		expect(resolveLocale({ browserLanguages: ['cs-CZ'] })).toBe('cs');
	});

	it('WEB-I18N-03: cz → cs', () => {
		expect(resolveLocale({ browserLanguages: ['cz'] })).toBe('cs');
	});

	it('WEB-I18N-04: hu-HU → en', () => {
		expect(resolveLocale({ browserLanguages: ['hu-HU'] })).toBe('en');
	});

	it('WEB-I18N-05: localStorage sk overrides browser en', () => {
		expect(resolveLocale({ storageLocale: 'sk', browserLanguages: ['en-US'] })).toBe('sk');
	});

	it('WEB-I18N-06: empty languages → en', () => {
		expect(resolveLocale({ browserLanguages: [] })).toBe('en');
	});

	it('WEB-I18N-07: fr-FR before de → fr', () => {
		expect(resolveLocale({ browserLanguages: ['fr-FR', 'de-DE'] })).toBe('fr');
	});

	it('WEB-I18N-08: invalid localStorage ignored', () => {
		expect(resolveLocale({ storageLocale: 'invalid', browserLanguages: ['hu-HU'] })).toBe('en');
	});

	it('WEB-I18N-31: clearStoredLocale removes key', () => {
		localStorage.setItem(LOCALE_STORAGE_KEY, 'cs');
		clearStoredLocale();
		expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
	});

	it('WEB-I18N-41: es-MX → es', () => {
		expect(resolveLocale({ browserLanguages: ['es-MX'] })).toBe('es');
	});

	it('WEB-I18N-42: pt-BR and pt-PT → pt', () => {
		expect(resolveLocale({ browserLanguages: ['pt-BR'] })).toBe('pt');
		expect(resolveLocale({ browserLanguages: ['pt-PT', 'en'] })).toBe('pt');
	});

	it('WEB-I18N-43: de-DE and nl-BE regional tags', () => {
		expect(resolveLocale({ browserLanguages: ['de-DE'] })).toBe('de');
		expect(resolveLocale({ browserLanguages: ['nl-BE'] })).toBe('nl');
	});

	it('WEB-I18N-44: whitespace and mixed-case tags', () => {
		expect(normalizeBrowserTag('  CS-cz  ')).toBe('cs');
		expect(tagToSupportedLocale('FR-fr')).toBe('fr');
	});

	it('WEB-I18N-45: en-GB alone → en', () => {
		expect(resolveLocale({ browserLanguages: ['en-GB'] })).toBe('en');
	});

	it('WEB-I18N-46: zh-CN and ja → en fallback', () => {
		expect(resolveLocale({ browserLanguages: ['zh-CN', 'ja-JP'] })).toBe('en');
	});

	it('WEB-I18N-47: storage wins over earlier supported browser tag', () => {
		expect(resolveLocale({ storageLocale: 'pl', browserLanguages: ['de-DE', 'fr-FR'] })).toBe('pl');
	});

	it('WEB-I18N-48: tagToSupportedLocale returns null for unknown', () => {
		expect(tagToSupportedLocale('xx')).toBeNull();
		expect(tagToSupportedLocale('')).toBeNull();
	});

	it('WEB-I18N-49: resolveDisplayLocale maps all ten codes', () => {
		for (const code of SUPPORTED_LOCALES) {
			expect(resolveDisplayLocale(code)).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
		}
		expect(resolveDisplayLocale('cs')).toBe('cs-CZ');
		expect(resolveDisplayLocale('sk')).toBe('sk-SK');
	});

	it('WEB-I18N-50: readStoredLocale returns null when empty', () => {
		localStorage.removeItem(LOCALE_STORAGE_KEY);
		expect(readStoredLocale()).toBeNull();
		localStorage.setItem(LOCALE_STORAGE_KEY, 'it');
		expect(readStoredLocale()).toBe('it');
	});

	it('WEB-I18N-51: first supported tag in long navigator list', () => {
		expect(resolveLocale({ browserLanguages: ['xx', 'yy', 'it-IT', 'en'] })).toBe('it');
	});

	it('WEB-I18N-52: invalid storage with supported browser picks browser', () => {
		expect(resolveLocale({ storageLocale: '  ', browserLanguages: ['sk-SK'] })).toBe('sk');
	});
});
