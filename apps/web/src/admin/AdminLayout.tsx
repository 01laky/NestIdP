import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { API_CONNECTION_ROUTE_PREFIX, SP_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminApiError, getAdminMe, logoutAdmin } from './adminApi';

export function AdminLayout() {
	const navigate = useNavigate();
	const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated'>(
		'loading',
	);

	useEffect(() => {
		let cancelled = false;

		void (async () => {
			try {
				await getAdminMe();
				if (!cancelled) {
					setAuthState('authenticated');
				}
			} catch (err) {
				if (cancelled) {
					return;
				}
				if (err instanceof AdminApiError && err.statusCode === 401) {
					try {
						await logoutAdmin();
					} catch {
						// ignore logout errors when clearing stale cookie
					}
				}
				setAuthState('unauthenticated');
			}
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	async function handleLogout() {
		try {
			await logoutAdmin();
		} finally {
			navigate('/admin/login', { replace: true });
		}
	}

	if (authState === 'loading') {
		return (
			<div className="layout">
				<div className="card">
					<p className="muted">Loading admin session…</p>
				</div>
			</div>
		);
	}

	if (authState === 'unauthenticated') {
		return <Navigate to="/admin/login" replace />;
	}

	return (
		<div className="layout">
			<div className="card">
				<h1>NestIdP Admin</h1>
				<p className="muted">
					API connection CRUD is available via REST; configuration UI comes in a later prompt.
				</p>
				<button type="button" onClick={() => void handleLogout()}>
					Logout
				</button>
				<ul>
					<li>
						API connections (identity sync): <code>{API_CONNECTION_ROUTE_PREFIX}</code>
					</li>
					<li>
						SP connections (SAML apps): <code>{SP_CONNECTION_ROUTE_PREFIX}</code>
					</li>
				</ul>
				<Routes>
					<Route
						index
						element={
							<p className="muted">Dashboard placeholder for sync status and connection counts.</p>
						}
					/>
					<Route path="*" element={<p className="muted">Admin sub-route placeholder.</p>} />
				</Routes>
				<p>
					<Link to="/login">Go to SAML login page</Link>
				</p>
			</div>
		</div>
	);
}
