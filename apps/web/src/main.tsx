import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initI18n } from './i18n/i18n';
import { resolveLocale } from './i18n/resolve-locale';
import './styles/evergreen/index.css';

async function bootstrap() {
	const locale = resolveLocale();
	await initI18n(locale);
	createRoot(document.getElementById('root')!).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}

void bootstrap();
