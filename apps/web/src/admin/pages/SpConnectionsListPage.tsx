import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SP_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminApiError, listSpConnections } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';

export function SpConnectionsListPage() {
	useDocumentTitle('SP connections — NestIdP Admin');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [items, setItems] = useState<Awaited<ReturnType<typeof listSpConnections>>['items']>([]);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const data = await listSpConnections();
				if (!cancelled) {
					setItems(data.items);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof AdminApiError ? err.message : 'Failed to load SP connections');
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
				title="SP connections"
				subtitle="SAML service providers"
				breadcrumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'SP connections' }]}
				actions={
					<Link className="button-link" to={`${SP_CONNECTION_ROUTE_PREFIX}/new`}>
						New SP
					</Link>
				}
			/>
			{loading ? <LoadingState /> : null}
			{error ? <ErrorBanner message={error} /> : null}
			{!loading && !error && items.length === 0 ? (
				<EmptyState
					title="No SP connections"
					description="Register a SAML application to enable SSO."
					action={
						<Link className="button-link" to={`${SP_CONNECTION_ROUTE_PREFIX}/new`}>
							Create SP
						</Link>
					}
				/>
			) : null}
			{!loading && !error && items.length > 0 ? (
				<table className="admin-table">
					<thead>
						<tr>
							<th>Name</th>
							<th>Entity ID</th>
							<th>Active</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{items.map((item) => (
							<tr key={item.id}>
								<td>{item.name}</td>
								<td>
									<code>{item.spEntityId}</code>
								</td>
								<td>{item.active ? 'yes' : 'no'}</td>
								<td>
									<Link to={`${SP_CONNECTION_ROUTE_PREFIX}/${item.id}`}>Edit</Link> ·{' '}
									<Link to={`${SP_CONNECTION_ROUTE_PREFIX}/${item.id}/test-sso`}>Test SSO</Link>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			) : null}
		</section>
	);
}
