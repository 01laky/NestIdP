import { BROWSER_LOCALE_SENTINEL, SUPPORTED_LOCALES, type SupportedLocale } from '@nestidp/shared';
import { useTranslation } from 'react-i18next';
import { changeLocale } from '../i18n/i18n';
import { clearStoredLocale, readStoredLocale, resolveLocale } from '../i18n/resolve-locale';

const LOCALE_NATIVE_LABELS: Record<SupportedLocale, string> = {
	en: 'English',
	cs: 'Čeština',
	sk: 'Slovenčina',
	de: 'Deutsch',
	fr: 'Français',
	es: 'Español',
	pl: 'Polski',
	it: 'Italiano',
	pt: 'Português',
	nl: 'Nederlands',
};

export function LanguageSelect({ className = '' }: { className?: string }) {
	const { t } = useTranslation('common');
	const stored = readStoredLocale();
	const selectValue = stored ?? BROWSER_LOCALE_SENTINEL;

	async function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
		const value = event.target.value;
		if (value === BROWSER_LOCALE_SENTINEL) {
			clearStoredLocale();
			const next = resolveLocale();
			await changeLocale(next);
			return;
		}
		if (SUPPORTED_LOCALES.includes(value as SupportedLocale)) {
			await changeLocale(value as SupportedLocale);
		}
	}

	return (
		<label className={`evg-field evg-language-select ${className}`.trim()}>
			<span className="evg-field__label evg-sr-only">{t('language')}</span>
			<select
				className="evg-select"
				aria-label={t('language')}
				value={selectValue}
				onChange={(event) => void handleChange(event)}
			>
				<option value={BROWSER_LOCALE_SENTINEL}>{t('languageBrowser')}</option>
				{SUPPORTED_LOCALES.map((code) => (
					<option key={code} value={code}>
						{LOCALE_NATIVE_LABELS[code]}
					</option>
				))}
			</select>
		</label>
	);
}
