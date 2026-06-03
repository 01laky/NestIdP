import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	IDENTITY_ROLE_NEW_ROUTE,
	IDENTITY_ROUTE_PREFIX,
	identityRoleDetailRoute,
} from '@nestidp/shared';
import { AdminApiError, listIdentityRoles } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { identityOriginLabel, identityOriginToBadge } from '../status-badge';
import { Badge, Button, Select, Table } from '../../ui';

export function IdentityRolesPage() {
	useDocumentTitle('Roles — NestIdP Admin');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [origin, setOrigin] = useState('');
	const [items, setItems] = useState<Awaited<ReturnType<typeof listIdentityRoles>>['items']>([]);

	async function load(originFilter: string) {
		setLoading(true);
		setError(null);
		try {
			const data = await listIdentityRoles({
				limit: 100,
				origin: originFilter || undefined,
			});
			setItems(data.items);
		} catch (err) {
			setError(err instanceof AdminApiError ? err.message : 'Failed to load roles');
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
				title="Roles"
				breadcrumbs={[
					{ label: 'Dashboard', to: '/admin' },
					{ label: 'Identity' },
					{ label: 'Roles' },
				]}
				actions={
					<Link className="evg-btn evg-btn--primary" to={IDENTITY_ROLE_NEW_ROUTE}>
						Create manual role
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
						{items.map((role) => (
							<tr key={role.id}>
								<td>
									<Link to={identityRoleDetailRoute(role.id)}>{role.name}</Link>
								</td>
								<td>
									<Badge variant={identityOriginToBadge(role.origin)}>
										{identityOriginLabel(role.origin)}
									</Badge>
								</td>
								<td>{role.memberCount ?? '—'}</td>
							</tr>
						))}
					</tbody>
				</Table>
			) : null}
			<p>
				<Link to={`${IDENTITY_ROUTE_PREFIX}/users`}>Users</Link> ·{' '}
				<Link to={`${IDENTITY_ROUTE_PREFIX}/groups`}>Groups</Link>
			</p>
		</section>
	);
}
