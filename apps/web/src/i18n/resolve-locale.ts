import {
	DEFAULT_LOCALE,
	LOCALE_STORAGE_KEY,
	SUPPORTED_LOCALES,
	type SupportedLocale,
	isSupportedLocale,
} from '@nestidp/shared';

export type ResolveLocaleInput = {
	storageLocale?: string | null;
	browserLanguages?: readonly string[];
};

export function normalizeBrowserTag(tag: string): string {
	const base = tag.trim().split('-')[0].toLowerCase();
	if (base === 'cz') {
		return 'cs';
	}
	return base;
}

export function tagToSupportedLocale(tag: string): SupportedLocale | null {
	const base = normalizeBrowserTag(tag);
	return isSupportedLocale(base) ? base : null;
}

export function resolveLocale(input?: ResolveLocaleInput): SupportedLocale {
	if (input) {
		const stored = input.storageLocale?.trim();
		if (stored && isSupportedLocale(stored)) {
			return stored;
		}
		const languages = input.browserLanguages ?? [];
		for (const tag of languages) {
			const locale = tagToSupportedLocale(tag);
			if (locale) {
				return locale;
			}
		}
		return DEFAULT_LOCALE;
	}

	if (typeof localStorage !== 'undefined') {
		const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
		if (stored && isSupportedLocale(stored)) {
			return stored;
		}
	}

	if (typeof navigator !== 'undefined') {
		const languages =
			navigator.languages?.length > 0
				? navigator.languages
				: navigator.language
					? [navigator.language]
					: [];
		for (const tag of languages) {
			const locale = tagToSupportedLocale(tag);
			if (locale) {
				return locale;
			}
		}
	}

	return DEFAULT_LOCALE;
}

export function clearStoredLocale(): void {
	if (typeof localStorage !== 'undefined') {
		localStorage.removeItem(LOCALE_STORAGE_KEY);
	}
}

export function readStoredLocale(): string | null {
	if (typeof localStorage === 'undefined') {
		return null;
	}
	return localStorage.getItem(LOCALE_STORAGE_KEY);
}

export function resolveDisplayLocale(locale: SupportedLocale): string {
	const map: Record<SupportedLocale, string> = {
		en: 'en-US',
		cs: 'cs-CZ',
		sk: 'sk-SK',
		de: 'de-DE',
		fr: 'fr-FR',
		es: 'es-ES',
		pl: 'pl-PL',
		it: 'it-IT',
		pt: 'pt-PT',
		nl: 'nl-NL',
	};
	return map[locale];
}

export { SUPPORTED_LOCALES, DEFAULT_LOCALE, LOCALE_STORAGE_KEY };
