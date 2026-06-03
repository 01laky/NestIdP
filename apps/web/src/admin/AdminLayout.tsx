import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import {
	API_CONNECTION_ROUTE_PREFIX,
	IDENTITY_ROUTE_PREFIX,
	IDP_SETTINGS_ROUTE_PREFIX,
	AUDIT_ROUTE_PREFIX,
	ADMIN_USERS_ROUTE_PREFIX,
	SP_CONNECTION_ROUTE_PREFIX,
} from '@nestidp/shared';
import { AdminApiError, getAdminMe, logoutAdmin } from './adminApi';
import { ApiConnectionFormPage } from './pages/ApiConnectionFormPage';
import { ApiConnectionSyncPage } from './pages/ApiConnectionSyncPage';
import { ApiConnectionsListPage } from './pages/ApiConnectionsListPage';
import { DashboardPage } from './pages/DashboardPage';
import { IdentityGroupsPage } from './pages/IdentityGroupsPage';
import { IdentityRolesPage } from './pages/IdentityRolesPage';
import { IdentityUserDetailPage } from './pages/IdentityUserDetailPage';
import { IdentityUsersPage } from './pages/IdentityUsersPage';
import { SpConnectionFormPage } from './pages/SpConnectionFormPage';
import { SpConnectionTestSsoPage } from './pages/SpConnectionTestSsoPage';
import { IdpSettingsPage } from './pages/IdpSettingsPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { SpConnectionsListPage } from './pages/SpConnectionsListPage';
import { SyncLogDetailPage } from './pages/SyncLogDetailPage';

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
			<div className="admin-shell">
				<p className="muted admin-loading">Loading admin session…</p>
			</div>
		);
	}

	if (authState === 'unauthenticated') {
		return <Navigate to="/admin/login" replace />;
	}

	return (
		<div className="admin-shell">
			<aside className="admin-sidebar">
				<h1 className="admin-brand">NestIdP</h1>
				<nav className="admin-nav">
					<Link to="/admin">Dashboard</Link>
					<Link to={API_CONNECTION_ROUTE_PREFIX}>API connections</Link>
					<Link to={SP_CONNECTION_ROUTE_PREFIX}>SP connections</Link>
					<Link to={`${IDENTITY_ROUTE_PREFIX}/users`}>Users</Link>
					<Link to={`${IDENTITY_ROUTE_PREFIX}/groups`}>Groups</Link>
					<Link to={`${IDENTITY_ROUTE_PREFIX}/roles`}>Roles</Link>
					<Link to={IDP_SETTINGS_ROUTE_PREFIX}>IdP Settings</Link>
					<Link to={ADMIN_USERS_ROUTE_PREFIX}>Admin accounts</Link>
					<Link to={AUDIT_ROUTE_PREFIX}>Audit log</Link>
					<Link to="/login">SAML login</Link>
				</nav>
				<button type="button" className="admin-logout" onClick={() => void handleLogout()}>
					Logout
				</button>
			</aside>
			<main className="admin-main">
				<Routes>
					<Route index element={<DashboardPage />} />
					<Route path="api-connections" element={<ApiConnectionsListPage />} />
					<Route path="api-connections/new" element={<ApiConnectionFormPage />} />
					<Route path="api-connections/:id" element={<ApiConnectionFormPage />} />
					<Route path="api-connections/:id/sync" element={<ApiConnectionSyncPage />} />
					<Route path="sync-logs/:syncLogId" element={<SyncLogDetailPage />} />
					<Route path="sp-connections" element={<SpConnectionsListPage />} />
					<Route path="sp-connections/new" element={<SpConnectionFormPage />} />
					<Route path="sp-connections/:id" element={<SpConnectionFormPage />} />
					<Route path="sp-connections/:id/test-sso" element={<SpConnectionTestSsoPage />} />
					<Route path="identity/users" element={<IdentityUsersPage />} />
					<Route path="identity/users/:id" element={<IdentityUserDetailPage />} />
					<Route path="identity/groups" element={<IdentityGroupsPage />} />
					<Route path="identity/roles" element={<IdentityRolesPage />} />
					<Route path="settings" element={<Navigate to={IDP_SETTINGS_ROUTE_PREFIX} replace />} />
					<Route path="settings/idp" element={<IdpSettingsPage />} />
					<Route path="settings/admins" element={<AdminUsersPage />} />
					<Route path="audit" element={<AuditLogPage />} />
					<Route path="*" element={<p className="muted">Page not found.</p>} />
				</Routes>
			</main>
		</div>
	);
}
