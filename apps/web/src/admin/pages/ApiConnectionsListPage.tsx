import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminApiError, listApiConnections } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { Table } from '../../ui';

export function ApiConnectionsListPage() {
	useDocumentTitle('API connections — NestIdP Admin');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [connections, setConnections] = useState<
		Awaited<ReturnType<typeof listApiConnections>>['connections']
	>([]);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const data = await listApiConnections();
				if (!cancelled) {
					setConnections(data.connections);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof AdminApiError ? err.message : 'Failed to load connections');
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

	return (
		<section>
			<AdminPageHeader
				title="API connections"
				subtitle="External identity API (Bearer)"
				breadcrumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'API connections' }]}
				actions={
					<Link className="evg-btn evg-btn--link" to={`${API_CONNECTION_ROUTE_PREFIX}/new`}>
						New connection
					</Link>
				}
			/>
			{loading ? <LoadingState /> : null}
			{error ? <ErrorBanner message={error} /> : null}
			{!loading && !error && connections.length === 0 ? (
				<EmptyState
					title="No API connections"
					description="Create one to sync users, groups, and roles."
					action={
						<Link className="evg-btn evg-btn--link" to={`${API_CONNECTION_ROUTE_PREFIX}/new`}>
							Create connection
						</Link>
					}
				/>
			) : null}
			{!loading && !error && connections.length > 0 ? (
				<Table>
					<thead>
						<tr>
							<th>Name</th>
							<th>Base URL</th>
							<th>Last sync</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{connections.map((connection) => (
							<tr key={connection.id}>
								<td>{connection.name}</td>
								<td>
									<code>{connection.baseUrl}</code>
								</td>
								<td>{connection.lastSyncStatus}</td>
								<td>
									<Link to={`${API_CONNECTION_ROUTE_PREFIX}/${connection.id}`}>Edit</Link> ·{' '}
									<Link to={`${API_CONNECTION_ROUTE_PREFIX}/${connection.id}/sync`}>Sync</Link>
								</td>
							</tr>
						))}
					</tbody>
				</Table>
			) : null}
		</section>
	);
}
