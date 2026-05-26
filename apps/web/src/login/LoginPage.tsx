import { Link } from 'react-router-dom';

export function LoginPage() {
	return (
		<div className="layout">
			<div className="card">
				<h1>SAML Login</h1>
				<p className="muted">
					End-user login placeholder. Username and password form will authenticate against synced
					credentials in a later prompt.
				</p>
				<form
					onSubmit={(event) => {
						event.preventDefault();
					}}
				>
					<p>
						<label>
							Username
							<br />
							<input name="username" autoComplete="username" disabled placeholder="Coming soon" />
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
								disabled
								placeholder="Coming soon"
							/>
						</label>
					</p>
					<button type="submit" disabled>
						Sign in (stub)
					</button>
				</form>
				<p>
					<Link to="/admin">Back to admin</Link>
				</p>
			</div>
		</div>
	);
}
