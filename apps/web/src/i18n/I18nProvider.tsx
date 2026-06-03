import { type ReactNode, useEffect, useState } from 'react';
import type { SupportedLocale } from '@nestidp/shared';
import { initI18n } from './i18n';
import { resolveLocale } from './resolve-locale';

export function I18nProvider({ children }: { children: ReactNode }) {
	const [ready, setReady] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const locale = resolveLocale();
		void initI18n(locale).then(() => {
			if (!cancelled) {
				setReady(true);
			}
		});
		return () => {
			cancelled = true;
		};
	}, []);

	if (!ready) {
		return null;
	}

	return <>{children}</>;
}

export async function initI18nForTests(locale: SupportedLocale = 'en'): Promise<void> {
	await initI18n(locale);
}
