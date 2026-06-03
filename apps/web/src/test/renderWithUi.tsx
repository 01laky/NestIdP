import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { initI18nForTests } from '../i18n/I18nProvider';
import { getI18n } from '../i18n/i18n';
import { ToastProvider } from '../ui';

export async function initTestI18n() {
	await initI18nForTests('en');
}

export function renderWithUi(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
	function Wrapper({ children }: { children: ReactNode }) {
		return (
			<I18nextProvider i18n={getI18n()}>
				<ToastProvider>{children}</ToastProvider>
			</I18nextProvider>
		);
	}
	return render(ui, { wrapper: Wrapper, ...options });
}
