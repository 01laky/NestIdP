import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { IDP_SETTINGS_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminApiError, getAdminMe, logoutAdmin } from './adminApi';
import { ApiConnectionFormPage } from './pages/ApiConnectionFormPage';
import { ApiConnectionSyncPage } from './pages/ApiConnectionSyncPage';
import { ApiConnectionsListPage } from './pages/ApiConnectionsListPage';
import { DashboardPage } from './pages/DashboardPage';
import { IdentityGroupDetailPage } from './pages/IdentityGroupDetailPage';
import { IdentityGroupFormPage } from './pages/IdentityGroupFormPage';
import { IdentityGroupsPage } from './pages/IdentityGroupsPage';
import { IdentityRoleDetailPage } from './pages/IdentityRoleDetailPage';
import { IdentityRoleFormPage } from './pages/IdentityRoleFormPage';
import { IdentityRolesPage } from './pages/IdentityRolesPage';
import { IdentityUserDetailPage } from './pages/IdentityUserDetailPage';
import { IdentityUserFormPage } from './pages/IdentityUserFormPage';
import { IdentityUsersPage } from './pages/IdentityUsersPage';
import { SpConnectionFormPage } from './pages/SpConnectionFormPage';
import { SpConnectionTestSsoPage } from './pages/SpConnectionTestSsoPage';
import { IdpSettingsPage } from './pages/IdpSettingsPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { SpConnectionsListPage } from './pages/SpConnectionsListPage';
import { SyncLogDetailPage } from './pages/SyncLogDetailPage';
import { AppShell, EmptyState, LoadingState, ToastProvider } from '../ui';

export function AdminLayout() {
	const navigate = useNavigate();
	const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated'>(
		'loading',
	);
	const [operatorUsername, setOperatorUsername] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		void (async () => {
			try {
				const me = await getAdminMe();
				if (!cancelled) {
					setOperatorUsername(me.admin.username);
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
				setOperatorUsername(null);
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
			<div className="evg-auth-layout">
				<LoadingState message="Loading admin session…" />
			</div>
		);
	}

	if (authState === 'unauthenticated') {
		return <Navigate to="/admin/login" replace />;
	}

	return (
		<ToastProvider>
			<AppShell operatorUsername={operatorUsername} onLogout={() => void handleLogout()}>
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
					<Route path="identity/users/new" element={<IdentityUserFormPage />} />
					<Route path="identity/users/:id/edit" element={<IdentityUserFormPage />} />
					<Route path="identity/users/:id" element={<IdentityUserDetailPage />} />
					<Route path="identity/groups" element={<IdentityGroupsPage />} />
					<Route path="identity/groups/new" element={<IdentityGroupFormPage />} />
					<Route path="identity/groups/:id/edit" element={<IdentityGroupFormPage />} />
					<Route path="identity/groups/:id" element={<IdentityGroupDetailPage />} />
					<Route path="identity/roles" element={<IdentityRolesPage />} />
					<Route path="identity/roles/new" element={<IdentityRoleFormPage />} />
					<Route path="identity/roles/:id/edit" element={<IdentityRoleFormPage />} />
					<Route path="identity/roles/:id" element={<IdentityRoleDetailPage />} />
					<Route path="settings" element={<Navigate to={IDP_SETTINGS_ROUTE_PREFIX} replace />} />
					<Route path="settings/idp" element={<IdpSettingsPage />} />
					<Route path="settings/admins" element={<AdminUsersPage />} />
					<Route path="audit" element={<AuditLogPage />} />
					<Route
						path="*"
						element={
							<EmptyState
								title="Page not found"
								description="This admin route does not exist."
								action={
									<a className="evg-btn evg-btn--link" href="/admin">
										Back to dashboard
									</a>
								}
							/>
						}
					/>
				</Routes>
			</AppShell>
		</ToastProvider>
	);
}
