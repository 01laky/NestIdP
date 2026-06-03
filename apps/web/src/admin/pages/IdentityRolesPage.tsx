import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { IDENTITY_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminApiError, listIdentityRoles } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';

export function IdentityRolesPage() {
	useDocumentTitle('Roles — NestIdP Admin');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [items, setItems] = useState<Awaited<ReturnType<typeof listIdentityRoles>>['items']>([]);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const data = await listIdentityRoles({ limit: 100 });
				if (!cancelled) {
					setItems(data.items);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof AdminApiError ? err.message : 'Failed to load roles');
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
				title="Roles"
				breadcrumbs={[
					{ label: 'Dashboard', to: '/admin' },
					{ label: 'Identity' },
					{ label: 'Roles' },
				]}
			/>
			{loading ? <LoadingState /> : null}
			{error ? <ErrorBanner message={error} /> : null}
			{!loading && !error ? (
				<ul className="evg-list">
					{items.map((role) => (
						<li key={role.id}>
							{role.name} <span className="evg-muted">({role.externalId})</span>
						</li>
					))}
				</ul>
			) : null}
			<p>
				<Link to={`${IDENTITY_ROUTE_PREFIX}/users`}>Users</Link> ·{' '}
				<Link to={`${IDENTITY_ROUTE_PREFIX}/groups`}>Groups</Link>
			</p>
		</section>
	);
}
