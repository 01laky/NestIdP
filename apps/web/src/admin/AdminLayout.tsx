import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IDP_SETTINGS_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminApiError, getAdminMe, logoutAdmin } from './adminApi';

// Route-level code splitting: each admin page is a separate chunk loaded on navigation, keeping the
// main bundle small (enforced by scripts/check-web-bundle-size.mjs). Pages are named exports, so each
// import is mapped to a default for React.lazy.
const lazyPage = <T extends Record<string, React.ComponentType>>(
	loader: () => Promise<T>,
	name: keyof T,
) => lazy(() => loader().then((m) => ({ default: m[name] })));

const ApiConnectionFormPage = lazyPage(
	() => import('./pages/ApiConnectionFormPage'),
	'ApiConnectionFormPage',
);
const ApiConnectionSyncPage = lazyPage(
	() => import('./pages/ApiConnectionSyncPage'),
	'ApiConnectionSyncPage',
);
const ApiConnectionsListPage = lazyPage(
	() => import('./pages/ApiConnectionsListPage'),
	'ApiConnectionsListPage',
);
const DashboardPage = lazyPage(() => import('./pages/DashboardPage'), 'DashboardPage');
const SyncSchedulesPage = lazyPage(() => import('./pages/SyncSchedulesPage'), 'SyncSchedulesPage');
const IdentityGroupDetailPage = lazyPage(
	() => import('./pages/IdentityGroupDetailPage'),
	'IdentityGroupDetailPage',
);
const IdentityGroupFormPage = lazyPage(
	() => import('./pages/IdentityGroupFormPage'),
	'IdentityGroupFormPage',
);
const IdentityGroupsPage = lazyPage(
	() => import('./pages/IdentityGroupsPage'),
	'IdentityGroupsPage',
);
const IdentityRoleDetailPage = lazyPage(
	() => import('./pages/IdentityRoleDetailPage'),
	'IdentityRoleDetailPage',
);
const IdentityRoleFormPage = lazyPage(
	() => import('./pages/IdentityRoleFormPage'),
	'IdentityRoleFormPage',
);
const IdentityRolesPage = lazyPage(() => import('./pages/IdentityRolesPage'), 'IdentityRolesPage');
const IdentityUserDetailPage = lazyPage(
	() => import('./pages/IdentityUserDetailPage'),
	'IdentityUserDetailPage',
);
const IdentityUserFormPage = lazyPage(
	() => import('./pages/IdentityUserFormPage'),
	'IdentityUserFormPage',
);
const IdentityUsersPage = lazyPage(() => import('./pages/IdentityUsersPage'), 'IdentityUsersPage');
const SpConnectionFormPage = lazyPage(
	() => import('./pages/SpConnectionFormPage'),
	'SpConnectionFormPage',
);
const SpConnectionTestSsoPage = lazyPage(
	() => import('./pages/SpConnectionTestSsoPage'),
	'SpConnectionTestSsoPage',
);
const IdpSettingsPage = lazyPage(() => import('./pages/IdpSettingsPage'), 'IdpSettingsPage');
const AdminUsersPage = lazyPage(() => import('./pages/AdminUsersPage'), 'AdminUsersPage');
const ExternalIdentityDatabasePage = lazyPage(
	() => import('./pages/ExternalIdentityDatabasePage'),
	'ExternalIdentityDatabasePage',
);
const AuditLogPage = lazyPage(() => import('./pages/AuditLogPage'), 'AuditLogPage');
const SpConnectionsListPage = lazyPage(
	() => import('./pages/SpConnectionsListPage'),
	'SpConnectionsListPage',
);
const SamlSessionsPage = lazyPage(() => import('./pages/SamlSessionsPage'), 'SamlSessionsPage');
const SyncLogDetailPage = lazyPage(() => import('./pages/SyncLogDetailPage'), 'SyncLogDetailPage');
import { AppShell, ConfirmProvider, EmptyState, LoadingState, ToastProvider } from '../ui';

export function AdminLayout() {
	const { t } = useTranslation('common');
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
				<LoadingState message={t('loadingAdminSession')} />
			</div>
		);
	}

	if (authState === 'unauthenticated') {
		return <Navigate to="/admin/login?reason=session_expired" replace />;
	}

	return (
		<ToastProvider>
			<AppShell operatorUsername={operatorUsername} onLogout={() => void handleLogout()}>
				<ConfirmProvider>
					<Suspense fallback={<LoadingState />}>
						<Routes>
							<Route index element={<DashboardPage />} />
							<Route path="api-connections" element={<ApiConnectionsListPage />} />
							<Route path="api-connections/new" element={<ApiConnectionFormPage />} />
							<Route path="api-connections/:id" element={<ApiConnectionFormPage />} />
							<Route path="api-connections/:id/sync" element={<ApiConnectionSyncPage />} />
							<Route path="sync-schedules" element={<SyncSchedulesPage />} />
							<Route path="sync-logs/:syncLogId" element={<SyncLogDetailPage />} />
							<Route path="sp-connections" element={<SpConnectionsListPage />} />
							<Route path="sp-connections/new" element={<SpConnectionFormPage />} />
							<Route path="sp-connections/:id" element={<SpConnectionFormPage />} />
							<Route path="sp-connections/:id/test-sso" element={<SpConnectionTestSsoPage />} />
							<Route path="sessions" element={<SamlSessionsPage />} />
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
							<Route
								path="settings"
								element={<Navigate to={IDP_SETTINGS_ROUTE_PREFIX} replace />}
							/>
							<Route path="settings/idp" element={<IdpSettingsPage />} />
							<Route path="settings/admins" element={<AdminUsersPage />} />
							<Route path="settings/identity-database" element={<ExternalIdentityDatabasePage />} />
							<Route path="audit" element={<AuditLogPage />} />
							<Route
								path="*"
								element={
									<EmptyState
										title={t('pageNotFound')}
										description={t('pageNotFoundDescription')}
										action={
											<a className="evg-btn evg-btn--link" href="/admin">
												{t('backToDashboard')}
											</a>
										}
									/>
								}
							/>
						</Routes>
					</Suspense>
				</ConfirmProvider>
			</AppShell>
		</ToastProvider>
	);
}
