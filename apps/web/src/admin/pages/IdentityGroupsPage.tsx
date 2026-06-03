import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { IDENTITY_GROUP_NEW_ROUTE, identityGroupDetailRoute } from '@nestidp/shared';
import { AdminApiError, listIdentityGroups } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { IdentitySectionNav } from '../components/IdentitySectionNav';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { identityOriginLabel, identityOriginToBadge } from '../status-badge';
import { Badge, Button, ButtonLink, Select, Table } from '../../ui';

export function IdentityGroupsPage() {
	useDocumentTitle('Groups — NestIdP Admin');
	const [loading, setLoading] = useState(true);
	const [filterBusy, setFilterBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [origin, setOrigin] = useState('');
	const [items, setItems] = useState<Awaited<ReturnType<typeof listIdentityGroups>>['items']>([]);

	async function load(originFilter: string, options?: { fromFilter?: boolean }) {
		if (options?.fromFilter) {
			setFilterBusy(true);
		}
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
				title="Groups"
				breadcrumbs={[
					{ label: 'Dashboard', to: '/admin' },
					{ label: 'Identity' },
					{ label: 'Groups' },
				]}
				actions={
					<ButtonLink to={IDENTITY_GROUP_NEW_ROUTE} variant="primary">
						Create manual group
					</ButtonLink>
				}
			/>
			<form
				className="evg-inline-form"
				aria-label="Filter groups"
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
				</div>
			) : null}
			<IdentitySectionNav current="groups" />
		</section>
	);
}
