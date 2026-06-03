import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, Callout, LoadingState, TextInput, Button } from '../ui';
import { LanguageSelect } from '../ui/LanguageSelect';
import { AdminApiError, getAdminMe, loginAdmin } from './adminApi';
import { formatAuthApiError, resolveI18nKey } from '../i18n/api-error-messages';

export function AdminLoginPage() {
	const { t } = useTranslation('adminAuth');
	const { t: tCommon } = useTranslation('common');
	const navigate = useNavigate();
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [checkingSession, setCheckingSession] = useState(true);

	useEffect(() => {
		let cancelled = false;

		void (async () => {
			try {
				await getAdminMe();
				if (!cancelled) {
					navigate('/admin', { replace: true });
				}
			} catch {
				if (!cancelled) {
					setCheckingSession(false);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [navigate]);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		setLoading(true);

		try {
			await loginAdmin({ username, password });
			navigate('/admin');
		} catch (err) {
			if (err instanceof AdminApiError) {
				setError(formatAuthApiError(err.message, resolveI18nKey));
			} else {
				setError(t('loginFailed'));
			}
		} finally {
			setLoading(false);
		}
	}

	if (checkingSession) {
		return (
			<div className="evg-auth-layout">
				<Card>
					<LoadingState message={t('checkingSession')} />
				</Card>
			</div>
		);
	}

	return (
		<div className="evg-auth-layout">
			<Card>
				<h1>{t('title')}</h1>
				<p className="evg-muted">{t('subtitle')}</p>
				<form onSubmit={(event) => void handleSubmit(event)}>
					<TextInput
						label={tCommon('username')}
						name="username"
						autoComplete="username"
						value={username}
						onChange={(event) => setUsername(event.target.value)}
						disabled={loading}
						required
						requiredMark
					/>
					<TextInput
						label={tCommon('password')}
						name="password"
						type="password"
						autoComplete="current-password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						disabled={loading}
						required
						requiredMark
					/>
					{error ? <Callout variant="danger">{error}</Callout> : null}
					<Button type="submit" variant="primary" block disabled={loading}>
						{loading ? t('signingIn') : t('signIn')}
					</Button>
				</form>
				<p>
					<Link to="/login">{t('endUserSamlLink')}</Link>
				</p>
				<LanguageSelect />
			</Card>
		</div>
	);
}
