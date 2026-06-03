export const SUPPORTED_LOCALES = [
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
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

export const LOCALE_STORAGE_KEY = 'nestidp.locale';

/** LanguageSelect value when following navigator (not stored in localStorage). */
export const BROWSER_LOCALE_SENTINEL = 'browser';

export function isSupportedLocale(value: string): value is SupportedLocale {
	return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
