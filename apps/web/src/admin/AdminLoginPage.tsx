import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, Callout, LoadingState, TextInput, Button } from '../ui';
import { AdminApiError, getAdminMe, loginAdmin } from './adminApi';

export function AdminLoginPage() {
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
				setError(err.message);
			} else {
				setError('Login failed');
			}
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
				<h1>Admin Login</h1>
				<p className="evg-muted">Operator console — separate from end-user SAML SSO.</p>
				<form onSubmit={(event) => void handleSubmit(event)}>
					<TextInput
						label="Username"
						name="username"
						autoComplete="username"
						value={username}
						onChange={(event) => setUsername(event.target.value)}
						disabled={loading}
						required
						requiredMark
					/>
					<TextInput
						label="Password"
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
						{loading ? 'Signing in…' : 'Sign in'}
					</Button>
				</form>
				<p>
					<Link to="/login">End-user SAML SSO login</Link>
				</p>
			</Card>
		</div>
	);
}
