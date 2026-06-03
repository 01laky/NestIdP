import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
	DEFAULT_LOCALE,
	LOCALE_STORAGE_KEY,
	type SupportedLocale,
	isSupportedLocale,
} from '@nestidp/shared';
import { I18N_NAMESPACES, type I18nNamespace } from './namespaces';
import en from './locales/en.json';
import { resolveDisplayLocale } from './resolve-locale';

type LocaleJson = Record<I18nNamespace, Record<string, unknown>>;

const localeModules = import.meta.glob<{ default: LocaleJson }>('./locales/*.json');

const loadedLocales = new Set<SupportedLocale>([DEFAULT_LOCALE]);

function resourcesFromJson(json: LocaleJson): Record<string, Record<string, unknown>> {
	return Object.fromEntries(
		I18N_NAMESPACES.map((ns) => [ns, (json[ns] ?? {}) as Record<string, unknown>]),
	);
}

async function loadLocaleBundles(locale: SupportedLocale): Promise<void> {
	if (loadedLocales.has(locale)) {
		return;
	}
	const path = `./locales/${locale}.json`;
	const loader = localeModules[path];
	if (!loader) {
		return;
	}
	const mod = await loader();
	const json = mod.default ?? (mod as unknown as LocaleJson);
	for (const ns of I18N_NAMESPACES) {
		i18n.addResourceBundle(locale, ns, (json[ns] ?? {}) as Record<string, unknown>, true, true);
	}
	loadedLocales.add(locale);
}

let initPromise: Promise<void> | null = null;

export async function initI18n(locale: SupportedLocale): Promise<void> {
	if (!initPromise) {
		initPromise = (async () => {
			await i18n.use(initReactI18next).init({
				lng: locale,
				fallbackLng: DEFAULT_LOCALE,
				ns: [...I18N_NAMESPACES],
				defaultNS: 'common',
				resources: {
					[DEFAULT_LOCALE]: resourcesFromJson(en as LocaleJson),
				},
				interpolation: { escapeValue: false },
				react: { useSuspense: false },
			});
		})();
	}
	await initPromise;
	await loadLocaleBundles(locale);
	if (i18n.language !== locale) {
		await i18n.changeLanguage(locale);
	}
	document.documentElement.lang = locale;
}

export async function changeLocale(locale: SupportedLocale): Promise<void> {
	await initI18n(locale);
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(LOCALE_STORAGE_KEY, locale);
	}
}

export function getI18n() {
	return i18n;
}

export function formatDateTime(value: string | Date, locale?: SupportedLocale): string {
	const tag = resolveDisplayLocale(locale ?? (i18n.language as SupportedLocale));
	const date = typeof value === 'string' ? new Date(value) : value;
	return date.toLocaleString(tag);
}

export { LOCALE_STORAGE_KEY, isSupportedLocale };
