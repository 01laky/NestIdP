import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	IDENTITY_GROUP_NEW_ROUTE,
	IDENTITY_ROUTE_PREFIX,
	identityGroupDetailRoute,
} from '@nestidp/shared';
import { AdminApiError, listIdentityGroups } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { identityOriginLabel, identityOriginToBadge } from '../status-badge';
import { Badge, Button, Select, Table } from '../../ui';

export function IdentityGroupsPage() {
	useDocumentTitle('Groups — NestIdP Admin');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [origin, setOrigin] = useState('');
	const [items, setItems] = useState<Awaited<ReturnType<typeof listIdentityGroups>>['items']>([]);

	async function load(originFilter: string) {
		setLoading(true);
		setError(null);
		try {
			const data = await listIdentityGroups({
				limit: 100,
				origin: originFilter || undefined,
			});
			setItems(data.items);
		} catch (err) {
			setError(err instanceof AdminApiError ? err.message : 'Failed to load groups');
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		void load('');
	}, []);

	function handleFilter(event: FormEvent) {
		event.preventDefault();
		void load(origin);
	}

	return (
		<section>
			<AdminPageHeader
				title="Groups"
				breadcrumbs={[
					{ label: 'Dashboard', to: '/admin' },
					{ label: 'Identity' },
					{ label: 'Groups' },
				]}
				actions={
					<Link className="evg-btn evg-btn--primary" to={IDENTITY_GROUP_NEW_ROUTE}>
						Create manual group
					</Link>
				}
			/>
			<form className="evg-inline-form" onSubmit={handleFilter}>
				<Select label="Show" value={origin} onChange={(e) => setOrigin(e.target.value)}>
					<option value="">All</option>
					<option value="manual">Manual</option>
					<option value="synced">Synced</option>
				</Select>
				<Button type="submit" variant="secondary">
					Apply
				</Button>
			</form>
			{loading ? <LoadingState /> : null}
			{error ? <ErrorBanner message={error} /> : null}
			{!loading && !error ? (
				<Table>
					<thead>
						<tr>
							<th>Name</th>
							<th>Origin</th>
							<th>Members</th>
						</tr>
					</thead>
					<tbody>
						{items.map((group) => (
							<tr key={group.id}>
								<td>
									<Link to={identityGroupDetailRoute(group.id)}>{group.name}</Link>
								</td>
								<td>
									<Badge variant={identityOriginToBadge(group.origin)}>
										{identityOriginLabel(group.origin)}
									</Badge>
								</td>
								<td>{group.memberCount ?? '—'}</td>
							</tr>
						))}
					</tbody>
				</Table>
			) : null}
			<p>
				<Link to={`${IDENTITY_ROUTE_PREFIX}/users`}>Users</Link> ·{' '}
				<Link to={`${IDENTITY_ROUTE_PREFIX}/roles`}>Roles</Link>
			</p>
		</section>
	);
}
