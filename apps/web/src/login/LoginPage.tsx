import { FormEvent, useEffect, useState } from 'react';
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
	const [ssoStubMessage, setSsoStubMessage] = useState<string | null>(null);
	const [sessionBanner, setSessionBanner] = useState<string | null>(null);
	const [samlSessionBound, setSamlSessionBound] = useState(false);

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
			} catch {
				// ignore probe errors on mount
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [samlSessionId]);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setLoading(true);
		setError(null);
		setSuccess(null);
		setSsoStubMessage(null);
		try {
			const result = await loginEndUser({
				username,
				password,
				samlSessionId,
			});
			setSamlSessionBound(result.samlSessionBound);
			if (result.samlSessionBound) {
				setSuccess(
					'SSO session ready. Continue to your application when SAML delivery is enabled.',
				);
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

	async function handleContinueSso() {
		if (!samlSessionId) {
			return;
		}
		setSsoStubMessage(null);
		try {
			const body = await completeSsoLogin(samlSessionId);
			setSsoStubMessage(`${body.message} (session ${body.samlSessionId})`);
		} catch (err) {
			const message = err instanceof AuthApiError ? err.message : 'Could not continue SSO.';
			setSsoStubMessage(message);
		}
	}

	return (
		<div className="layout">
			<div className="card">
				<h1>SAML Login</h1>
				<p className="muted">Sign in with credentials synced from your identity API.</p>
				{sessionBanner ? <p className="muted">{sessionBanner}</p> : null}
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
								disabled={loading}
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
								disabled={loading}
							/>
						</label>
					</p>
					<button type="submit" disabled={loading}>
						{loading ? 'Signing in…' : 'Sign in'}
					</button>
				</form>
				{error ? <p role="alert">{error}</p> : null}
				{success ? <p>{success}</p> : null}
				{samlSessionBound && samlSessionId ? (
					<p>
						<button type="button" onClick={() => void handleContinueSso()}>
							Continue to application
						</button>
					</p>
				) : null}
				{ssoStubMessage ? <p className="muted">{ssoStubMessage}</p> : null}
				<p>
					<Link to="/admin">Back to admin</Link>
				</p>
			</div>
		</div>
	);
}
