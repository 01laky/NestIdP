import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { Badge, Panel, StatCard } from '../../ui';
import { certStatusLabel, certStatusToBadge, lastSyncStatusToBadge } from '../status-badge';

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
			<div className="evg-stats-grid evg-stats-grid--dashboard">
				<StatCard label="Users" value={counts.users} />
				<StatCard label="Groups" value={counts.groups} />
				<StatCard label="Roles" value={counts.roles} />
				<StatCard label="API connections" value={counts.apiConnections} />
				<StatCard label="SP connections" value={counts.spConnections} />
			</div>
			{dashboard.apiConnection ? (
				<Panel title="Identity source">
					<p>
						<strong>{dashboard.apiConnection.name}</strong> — last sync{' '}
						<Badge variant={lastSyncStatusToBadge(dashboard.lastSyncStatus ?? 'NEVER')}>
							{dashboard.lastSyncStatus ?? 'NEVER'}
						</Badge>
						{dashboard.lastSyncAt ? (
							<span className="evg-muted"> at {dashboard.lastSyncAt}</span>
						) : null}
					</p>
					<p>
						<Link
							className="evg-btn evg-btn--link"
							to={`${API_CONNECTION_ROUTE_PREFIX}/${dashboard.apiConnection.id}/sync`}
						>
							Open sync
						</Link>
					</p>
				</Panel>
			) : (
				<p className="evg-muted">
					No API connection yet.{' '}
					<Link className="evg-btn evg-btn--link" to={`${API_CONNECTION_ROUTE_PREFIX}/new`}>
						Create one
					</Link>
					.
				</p>
			)}
			<Panel title="IdP configuration">
				<p>
					<Badge variant={certStatusToBadge(dashboard.idp.certStatus)}>
						{certStatusLabel(dashboard.idp.certStatus)}
					</Badge>
				</p>
				<p>
					<Link className="evg-btn evg-btn--link" to={dashboard.idp.idpSettingsRoute}>
						Configure IdP settings
					</Link>
				</p>
				{dashboard.idp.rotationActive ? (
					<p className="evg-muted">Complete or cancel certificate rotation in IdP settings.</p>
				) : null}
				{dashboard.idp.certStatus === 'expiring_soon' && dashboard.idp.signingCertNotAfter ? (
					<p className="evg-muted">
						Signing certificate expires on {dashboard.idp.signingCertNotAfter}.
					</p>
				) : null}
				<dl className="evg-dl">
					<div className="evg-dl__row">
						<dt>Entity ID</dt>
						<dd>
							<code>{dashboard.entityId}</code>
						</dd>
					</div>
					<div className="evg-dl__row">
						<dt>Metadata</dt>
						<dd>
							<a href={dashboard.metadataUrl} target="_blank" rel="noreferrer">
								{dashboard.metadataUrl}
							</a>
						</dd>
					</div>
					<div className="evg-dl__row">
						<dt>SSO</dt>
						<dd>
							<code>{dashboard.ssoUrl}</code>
						</dd>
					</div>
				</dl>
			</Panel>
			<Panel title="Operations">
				<p>
					<Link className="evg-btn evg-btn--link" to={dashboard.auditEventsRoute}>
						Audit log
					</Link>{' '}
					·{' '}
					<Link className="evg-btn evg-btn--link" to={dashboard.adminUsersRoute}>
						Admin accounts
					</Link>
				</p>
				<p className="evg-muted">
					See docs/RELEASE.md in the repository before production go-live.
				</p>
			</Panel>
			<p className="evg-muted">
				<Link className="evg-btn evg-btn--link" to={`${IDENTITY_ROUTE_PREFIX}/users`}>
					Browse users
				</Link>{' '}
				·{' '}
				<Link className="evg-btn evg-btn--link" to={SP_CONNECTION_ROUTE_PREFIX}>
					SP connections
				</Link>
			</p>
		</section>
	);
}
