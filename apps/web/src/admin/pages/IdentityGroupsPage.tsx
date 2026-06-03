import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { IDENTITY_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminApiError, listIdentityGroups } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';

export function IdentityGroupsPage() {
	useDocumentTitle('Groups — NestIdP Admin');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [items, setItems] = useState<Awaited<ReturnType<typeof listIdentityGroups>>['items']>([]);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const data = await listIdentityGroups({ limit: 100 });
				if (!cancelled) {
					setItems(data.items);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof AdminApiError ? err.message : 'Failed to load groups');
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
				title="Groups"
				breadcrumbs={[
					{ label: 'Dashboard', to: '/admin' },
					{ label: 'Identity' },
					{ label: 'Groups' },
				]}
			/>
			{loading ? <LoadingState /> : null}
			{error ? <ErrorBanner message={error} /> : null}
			{!loading && !error ? (
				<ul className="evg-list">
					{items.map((group) => (
						<li key={group.id}>
							{group.name} <span className="evg-muted">({group.externalId})</span>
						</li>
					))}
				</ul>
			) : null}
			<p>
				<Link to={`${IDENTITY_ROUTE_PREFIX}/users`}>Users</Link> ·{' '}
				<Link to={`${IDENTITY_ROUTE_PREFIX}/roles`}>Roles</Link>
			</p>
		</section>
	);
}
