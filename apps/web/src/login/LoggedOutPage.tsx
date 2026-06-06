import { useTranslation } from 'react-i18next';

export function LoggedOutPage() {
	const { t } = useTranslation('loggedOut');

	return (
		<main className="evg-auth-shell">
			<div className="evg-auth-card">
				<h1>{t('title')}</h1>
				<p className="evg-muted">{t('description')}</p>
				<p>
					<a href="/login">{t('backToLogin')}</a>
				</p>
			</div>
		</main>
	);
}
