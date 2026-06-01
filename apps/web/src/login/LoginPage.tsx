import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SAML_SESSION_QUERY_PARAM } from '@nestidp/shared';
import { AuthApiError, completeSsoLogin, getEndUserSession, loginEndUser } from '../auth/authApi';

export function LoginPage() {
	const [searchParams] = useSearchParams();
	const samlSessionId = searchParams.get(SAML_SESSION_QUERY_PARAM) ?? undefined;

	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [loading, setLoading] = useState(false);
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

	return (
		<div className="layout">
			<div className="card">
				<h1>SAML Login</h1>
				<p className="muted">Sign in with credentials synced from your identity API.</p>
				{sessionBanner ? <p className="muted">{sessionBanner}</p> : null}
				{ssoRedirecting ? <p className="muted">Redirecting to application…</p> : null}
				<form onSubmit={handleSubmit}>
					<p>
						<label>
							Username
							<br />
							<input
								name="username"
								autoComplete="username"
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								disabled={loading || ssoRedirecting}
							/>
						</label>
					</p>
					<p>
						<label>
							Password
							<br />
							<input
								name="password"
								type="password"
								autoComplete="current-password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								disabled={loading || ssoRedirecting}
							/>
						</label>
					</p>
					<button type="submit" disabled={loading || ssoRedirecting}>
						{loading ? 'Signing in…' : 'Sign in'}
					</button>
				</form>
				{error ? <p role="alert">{error}</p> : null}
				{success ? <p>{success}</p> : null}
				{(samlSessionBound || readyToComplete) && samlSessionId ? (
					<p>
						<button
							type="button"
							disabled={ssoRedirecting}
							onClick={() => void runCompleteSso(samlSessionId)}
						>
							Continue to application
						</button>
					</p>
				) : null}
				{ssoError ? <p role="alert">{ssoError}</p> : null}
				<p>
					<Link to="/admin">Back to admin</Link>
				</p>
			</div>
		</div>
	);
}
