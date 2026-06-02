import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AdminDashboardIdpCertStatus } from '@nestidp/shared';
import {
	API_CONNECTION_ROUTE_PREFIX,
	IDENTITY_ROUTE_PREFIX,
	SP_CONNECTION_ROUTE_PREFIX,
} from '@nestidp/shared';
import { AdminApiError, getAdminDashboard } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';

function idpCertStatusLabel(certStatus: AdminDashboardIdpCertStatus): string {
	switch (certStatus) {
		case 'missing':
			return 'No signing cert';
		case 'expiring_soon':
			return 'Expires soon';
		case 'rotation_active':
			return 'Rotation in progress';
		default:
			return 'Certificate OK';
	}
}

export function DashboardPage() {
	useDocumentTitle('Dashboard — NestIdP Admin');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [dashboard, setDashboard] = useState<Awaited<ReturnType<typeof getAdminDashboard>> | null>(
		null,
	);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const data = await getAdminDashboard();
				if (!cancelled) {
					setDashboard(data);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof AdminApiError ? err.message : 'Failed to load dashboard');
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	if (loading) {
		return <LoadingState message="Loading dashboard…" />;
	}

	if (error) {
		return <ErrorBanner message={error} />;
	}

	if (!dashboard) {
		return <ErrorBanner message="Dashboard unavailable" />;
	}

	const { counts } = dashboard;

	return (
		<section>
			<AdminPageHeader title="Dashboard" subtitle="Identity sync and SAML service providers" />
			<div className="admin-stats-grid">
				<div className="admin-stat">
					<span className="admin-stat-value">{counts.users}</span>
					<span className="muted">Users</span>
				</div>
				<div className="admin-stat">
					<span className="admin-stat-value">{counts.groups}</span>
					<span className="muted">Groups</span>
				</div>
				<div className="admin-stat">
					<span className="admin-stat-value">{counts.roles}</span>
					<span className="muted">Roles</span>
				</div>
				<div className="admin-stat">
					<span className="admin-stat-value">{counts.apiConnections}</span>
					<span className="muted">API connections</span>
				</div>
				<div className="admin-stat">
					<span className="admin-stat-value">{counts.spConnections}</span>
					<span className="muted">SP connections</span>
				</div>
			</div>
			{dashboard.apiConnection ? (
				<div className="admin-panel">
					<h3>Identity source</h3>
					<p>
						<strong>{dashboard.apiConnection.name}</strong> — last sync{' '}
						{dashboard.lastSyncStatus ?? 'NEVER'}
						{dashboard.lastSyncAt ? ` at ${dashboard.lastSyncAt}` : ''}
					</p>
					<p>
						<Link to={`${API_CONNECTION_ROUTE_PREFIX}/${dashboard.apiConnection.id}/sync`}>
							Open sync
						</Link>
					</p>
				</div>
			) : (
				<p className="muted">
					No API connection yet. <Link to={`${API_CONNECTION_ROUTE_PREFIX}/new`}>Create one</Link>.
				</p>
			)}
			<div className="admin-panel">
				<h3>IdP configuration</h3>
				<p>
					<span className="admin-badge">{idpCertStatusLabel(dashboard.idp.certStatus)}</span>
				</p>
				<p>
					<Link to={dashboard.idp.idpSettingsRoute}>Configure IdP settings</Link>
				</p>
				{dashboard.idp.rotationActive ? (
					<p className="muted">Complete or cancel certificate rotation in IdP settings.</p>
				) : null}
				{dashboard.idp.certStatus === 'expiring_soon' && dashboard.idp.signingCertNotAfter ? (
					<p className="muted">
						Signing certificate expires on {dashboard.idp.signingCertNotAfter}.
					</p>
				) : null}
				<ul className="admin-kv-list">
					<li>
						<span>Entity ID</span>
						<code>{dashboard.entityId}</code>
					</li>
					<li>
						<span>Metadata</span>
						<a href={dashboard.metadataUrl} target="_blank" rel="noreferrer">
							{dashboard.metadataUrl}
						</a>
					</li>
					<li>
						<span>SSO</span>
						<code>{dashboard.ssoUrl}</code>
					</li>
				</ul>
			</div>
			<p className="muted">
				<Link to={`${IDENTITY_ROUTE_PREFIX}/users`}>Browse users</Link> ·{' '}
				<Link to={SP_CONNECTION_ROUTE_PREFIX}>SP connections</Link>
			</p>
		</section>
	);
}
