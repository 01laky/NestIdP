import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SAML_SESSION_QUERY_PARAM } from '@nestidp/shared';
import { AuthApiError, completeSsoLogin, getEndUserSession, loginEndUser } from '../auth/authApi';
import { Button, Callout, Card, LoadingState, Spinner, TextInput } from '../ui';
import { LanguageSelect } from '../ui/LanguageSelect';
import { formatAuthApiError, resolveI18nKey } from '../i18n/api-error-messages';

export function LoginPage() {
	const { t } = useTranslation('login');
	const { t: tCommon } = useTranslation('common');
	const [searchParams] = useSearchParams();
	const samlSessionId = searchParams.get(SAML_SESSION_QUERY_PARAM) ?? undefined;

	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [loading, setLoading] = useState(false);
	const [checkingSession, setCheckingSession] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);
	const [ssoError, setSsoError] = useState<string | null>(null);
	const [ssoRedirecting, setSsoRedirecting] = useState(false);
	const [sessionBanner, setSessionBanner] = useState<string | null>(null);
	const [samlSessionBound, setSamlSessionBound] = useState(false);
	const [readyToComplete, setReadyToComplete] = useState(false);
	// Strict SP-only IdP (Prompt 36, Deliverable 10): the login form renders only when there is a live
	// pending SSO request. Without one we show a neutral notice — no form, no username, no session state.
	const [hasPendingRequest, setHasPendingRequest] = useState(false);
	const [retryAfter, setRetryAfter] = useState<number | null>(null);
	const autoCompleteAttempted = useRef(false);

	useEffect(() => {
		if (retryAfter === null || retryAfter <= 0) {
			return;
		}
		const id = setInterval(() => {
			setRetryAfter((s) => (s !== null && s > 1 ? s - 1 : null));
		}, 1000);
		return () => clearInterval(id);
	}, [retryAfter]);

	const submitSsoHtml = useCallback((html: string) => {
		document.open();
		document.write(html);
		document.close();
	}, []);

	const runCompleteSso = useCallback(
		async (sessionId: string) => {
			setSsoError(null);
			setSsoRedirecting(true);
			try {
				const html = await completeSsoLogin(sessionId);
				submitSsoHtml(html);
			} catch (err) {
				const message =
					err instanceof AuthApiError
						? formatAuthApiError(err.message, resolveI18nKey)
						: t('couldNotContinueSso');
				setSsoError(message);
			} finally {
				setSsoRedirecting(false);
			}
		},
		[submitSsoHtml, t],
	);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const status = await getEndUserSession(samlSessionId);
				if (cancelled) {
					return;
				}
				// A live pending request = a SamlSession in context that has not expired. We never surface a
				// standing "signed in as …" banner from the cookie alone (no standing-session leak).
				const pending = Boolean(status.samlSession) && !status.samlSession?.expired;
				setHasPendingRequest(pending);
				if (status.samlSession?.expired) {
					setSessionBanner(t('samlSessionExpired'));
				} else if (status.samlSession && !status.samlSession.spActive) {
					setSessionBanner(t('spInactive'));
				}
				setReadyToComplete(status.samlSession?.readyToComplete ?? false);

				if (
					status.samlSession?.readyToComplete &&
					samlSessionId &&
					!autoCompleteAttempted.current
				) {
					autoCompleteAttempted.current = true;
					await runCompleteSso(samlSessionId);
				}
			} catch {
				// ignore probe errors on mount
			} finally {
				if (!cancelled) {
					setCheckingSession(false);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [samlSessionId, runCompleteSso, t]);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setLoading(true);
		setError(null);
		setSuccess(null);
		setSsoError(null);
		try {
			const result = await loginEndUser({
				username,
				password,
				samlSessionId,
			});
			setSamlSessionBound(result.samlSessionBound);
			if (result.samlSessionBound && samlSessionId) {
				setSuccess(t('ssoReady'));
				autoCompleteAttempted.current = true;
				await runCompleteSso(samlSessionId);
			} else {
				setSuccess(t('signedInAs', { username: result.user.username }));
			}
		} catch (err) {
			if (err instanceof AuthApiError && err.statusCode === 429) {
				if (err.retryAfterSeconds) {
					setRetryAfter(err.retryAfterSeconds);
					setError(null);
				} else {
					setError(t('tooManyAttemptsGeneric'));
				}
			} else {
				const message =
					err instanceof AuthApiError
						? formatAuthApiError(err.message, resolveI18nKey)
						: t('signInFailed');
				setError(message);
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

	// No live SSO request → neutral notice only: no login form, no username field, no session indicator.
	if (!hasPendingRequest) {
		return (
			<div className="evg-auth-layout">
				<Card>
					<h1>{t('title')}</h1>
					<Callout variant="info">{t('noRequestNotice')}</Callout>
					<p>
						<Link to="/admin">{t('backToAdmin')}</Link>
					</p>
					<LanguageSelect />
				</Card>
			</div>
		);
	}

	return (
		<div className="evg-auth-layout">
			<Card>
				<h1>{t('title')}</h1>
				<p className="evg-muted">{t('subtitle')}</p>
				{sessionBanner ? <Callout variant="info">{sessionBanner}</Callout> : null}
				{ssoRedirecting ? <Spinner label={t('redirectingToApp')} /> : null}
				<form onSubmit={(event) => void handleSubmit(event)}>
					<TextInput
						label={tCommon('username')}
						name="username"
						autoComplete="username"
						value={username}
						onChange={(e) => setUsername(e.target.value)}
						disabled={loading || ssoRedirecting}
						required
						requiredMark
					/>
					<TextInput
						label={tCommon('password')}
						name="password"
						type="password"
						autoComplete="current-password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						disabled={loading || ssoRedirecting}
						required
						requiredMark
					/>
					<Button
						type="submit"
						variant="primary"
						block
						disabled={loading || ssoRedirecting || retryAfter !== null}
					>
						{loading ? t('signingIn') : t('signIn')}
					</Button>
				</form>
				{retryAfter !== null ? (
					<Callout variant="warning" role="alert">
						{t('tooManyAttempts', { seconds: retryAfter })}
					</Callout>
				) : null}
				{error ? <Callout variant="danger">{error}</Callout> : null}
				{success ? <Callout variant="success">{success}</Callout> : null}
				{(samlSessionBound || readyToComplete) && samlSessionId ? (
					<Button
						type="button"
						variant="secondary"
						block
						disabled={ssoRedirecting}
						onClick={() => void runCompleteSso(samlSessionId)}
					>
						{t('continueToApplication')}
					</Button>
				) : null}
				{ssoError ? <Callout variant="danger">{ssoError}</Callout> : null}
				<p>
					<Link to="/admin">{t('backToAdmin')}</Link>
				</p>
				<LanguageSelect />
			</Card>
		</div>
	);
}
