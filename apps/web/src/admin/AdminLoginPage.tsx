import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DEFAULT_ADMIN_SESSION_REMEMBER_TTL_SECONDS } from '@nestidp/shared';
import { Card, Callout, LoadingState, TextInput, Button, Checkbox } from '../ui';
import { LanguageSelect } from '../ui/LanguageSelect';
import { AdminApiError, getAdminMe, loginAdmin } from './adminApi';
import {
	clearRememberedAdminUsername,
	readRememberedAdminUsername,
	writeRememberedAdminUsername,
} from './adminRememberUsername';
import { formatAuthApiError, resolveI18nKey } from '../i18n/api-error-messages';

const STAY_SIGNED_IN_DAYS = Math.floor(DEFAULT_ADMIN_SESSION_REMEMBER_TTL_SECONDS / 86_400);

export function AdminLoginPage() {
	const { t } = useTranslation('adminAuth');
	const { t: tCommon } = useTranslation('common');
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [rememberUsername, setRememberUsername] = useState(false);
	const [staySignedIn, setStaySignedIn] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [checkingSession, setCheckingSession] = useState(true);
	const [retryAfter, setRetryAfter] = useState<number | null>(null);

	useEffect(() => {
		if (retryAfter === null || retryAfter <= 0) {
			return;
		}
		const id = setInterval(() => {
			setRetryAfter((s) => (s !== null && s > 1 ? s - 1 : null));
		}, 1000);
		return () => clearInterval(id);
	}, [retryAfter]);

	const sessionExpired = searchParams.get('reason') === 'session_expired';
	const showSharedWarning = rememberUsername || staySignedIn;

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

	useEffect(() => {
		if (checkingSession) {
			return;
		}
		const saved = readRememberedAdminUsername();
		if (saved) {
			setUsername(saved);
			setRememberUsername(true);
		}
	}, [checkingSession]);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		setLoading(true);

		try {
			await loginAdmin({
				username,
				password,
				rememberMe: staySignedIn,
			});
			if (rememberUsername) {
				writeRememberedAdminUsername(username.trim());
			} else {
				clearRememberedAdminUsername();
			}
			navigate('/admin');
		} catch (err) {
			if (err instanceof AdminApiError && err.statusCode === 429) {
				if (err.retryAfterSeconds) {
					setRetryAfter(err.retryAfterSeconds);
					setError(null);
				} else {
					setError(t('tooManyAttemptsGeneric'));
				}
			} else if (err instanceof AdminApiError) {
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
				{sessionExpired ? <Callout variant="warning">{t('sessionExpired')}</Callout> : null}
				{showSharedWarning ? (
					<Callout variant="warning">{t('sharedComputerWarning')}</Callout>
				) : null}
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
					<Checkbox
						label={t('rememberUsername')}
						hint={t('rememberUsernameHint')}
						checked={rememberUsername}
						onChange={setRememberUsername}
						disabled={loading}
					/>
					<Checkbox
						label={t('staySignedIn')}
						hint={t('staySignedInHint', { days: STAY_SIGNED_IN_DAYS })}
						checked={staySignedIn}
						onChange={setStaySignedIn}
						disabled={loading}
					/>
					{retryAfter !== null ? (
						<Callout variant="warning" role="alert">
							{t('tooManyAttempts', { seconds: retryAfter })}
						</Callout>
					) : null}
					{error ? <Callout variant="danger">{error}</Callout> : null}
					<Button type="submit" variant="primary" block disabled={loading || retryAfter !== null}>
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
