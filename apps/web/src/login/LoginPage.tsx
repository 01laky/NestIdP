import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SAML_SESSION_QUERY_PARAM } from '@nestidp/shared';
import { AuthApiError, completeSsoLogin, getEndUserSession, loginEndUser } from '../auth/authApi';
import { Button, Callout, Card, LoadingState, Spinner, TextInput } from '../ui';

export function LoginPage() {
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
	const autoCompleteAttempted = useRef(false);

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
				const message = err instanceof AuthApiError ? err.message : 'Could not continue SSO.';
				setSsoError(message);
			} finally {
				setSsoRedirecting(false);
			}
		},
		[submitSsoHtml],
	);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const status = await getEndUserSession(samlSessionId);
				if (cancelled) {
					return;
				}
				if (status.authenticated && status.user) {
					setSessionBanner(`Signed in as ${status.user.username}`);
				}
				if (status.samlSession?.expired) {
					setSessionBanner('SAML session expired. Sign in again to continue SSO.');
				} else if (status.samlSession && !status.samlSession.spActive) {
					setSessionBanner('Service provider connection is inactive.');
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
	}, [samlSessionId, runCompleteSso]);

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
				setSuccess('SSO session ready. Redirecting to your application…');
				autoCompleteAttempted.current = true;
				await runCompleteSso(samlSessionId);
			} else {
				setSuccess(`Signed in as ${result.user.username}`);
			}
		} catch (err) {
			const message =
				err instanceof AuthApiError ? err.message : 'Sign in failed. Please try again.';
			setError(message);
		} finally {
			setLoading(false);
		}
	}

	if (checkingSession) {
		return (
			<div className="evg-auth-layout">
				<Card>
					<LoadingState message="Checking session…" />
				</Card>
			</div>
		);
	}

	return (
		<div className="evg-auth-layout">
			<Card>
				<h1>SAML Login</h1>
				<p className="evg-muted">Sign in with credentials synced from your identity API.</p>
				{sessionBanner ? <Callout variant="info">{sessionBanner}</Callout> : null}
				{ssoRedirecting ? <Spinner label="Redirecting to application…" /> : null}
				<form onSubmit={(event) => void handleSubmit(event)}>
					<TextInput
						label="Username"
						name="username"
						autoComplete="username"
						value={username}
						onChange={(e) => setUsername(e.target.value)}
						disabled={loading || ssoRedirecting}
						required
						requiredMark
					/>
					<TextInput
						label="Password"
						name="password"
						type="password"
						autoComplete="current-password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						disabled={loading || ssoRedirecting}
						required
						requiredMark
					/>
					<Button type="submit" variant="primary" block disabled={loading || ssoRedirecting}>
						{loading ? 'Signing in…' : 'Sign in'}
					</Button>
				</form>
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
						Continue to application
					</Button>
				) : null}
				{ssoError ? <Callout variant="danger">{ssoError}</Callout> : null}
				<p>
					<Link to="/admin">Back to admin</Link>
				</p>
			</Card>
		</div>
	);
}
