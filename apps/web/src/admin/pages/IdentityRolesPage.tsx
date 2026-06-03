import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { IDENTITY_ROLE_NEW_ROUTE, identityRoleDetailRoute } from '@nestidp/shared';
import { AdminApiError, listIdentityRoles } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { IdentitySectionNav } from '../components/IdentitySectionNav';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { identityOriginLabel, identityOriginToBadge } from '../status-badge';
import { Badge, Button, ButtonLink, Select, Table } from '../../ui';

export function IdentityRolesPage() {
	useDocumentTitle('Roles — NestIdP Admin');
	const [loading, setLoading] = useState(true);
	const [filterBusy, setFilterBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [origin, setOrigin] = useState('');
	const [items, setItems] = useState<Awaited<ReturnType<typeof listIdentityRoles>>['items']>([]);

	async function load(originFilter: string, options?: { fromFilter?: boolean }) {
		if (options?.fromFilter) {
			setFilterBusy(true);
		}
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
			setFilterBusy(false);
		}
	}

	useEffect(() => {
		void load('');
	}, []);

	function handleFilter(event: FormEvent) {
		event.preventDefault();
		void load(origin, { fromFilter: true });
	}

	const filterDisabled = filterBusy;

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
					<ButtonLink to={IDENTITY_ROLE_NEW_ROUTE} variant="primary">
						Create manual role
					</ButtonLink>
				}
			/>
			<form
				className="evg-inline-form"
				aria-label="Filter roles"
				aria-busy={filterBusy}
				onSubmit={handleFilter}
			>
				<Select
					label="Origin"
					fieldClassName="evg-field--fixed"
					value={origin}
					onChange={(e) => setOrigin(e.target.value)}
					disabled={filterDisabled}
				>
					<option value="">All</option>
					<option value="manual">Manual</option>
					<option value="synced">Synced</option>
				</Select>
				<Button type="submit" variant="secondary" disabled={filterDisabled}>
					Apply
				</Button>
			</form>
			{loading ? <LoadingState /> : null}
			{error ? <ErrorBanner message={error} /> : null}
			{!loading && !error ? (
				<div className="evg-table-wrap">
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
				</div>
			) : null}
			<IdentitySectionNav current="roles" />
		</section>
	);
}
