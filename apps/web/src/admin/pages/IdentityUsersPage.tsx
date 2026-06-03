import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	API_CONNECTION_ROUTE_PREFIX,
	IDENTITY_ROUTE_PREFIX,
	IDENTITY_USER_NEW_ROUTE,
} from '@nestidp/shared';
import { AdminApiError, listIdentityUsers } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { IdentitySectionNav } from '../components/IdentitySectionNav';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { identityOriginLabel, identityOriginToBadge } from '../status-badge';
import { Badge, Button, ButtonLink, Panel, Select, Table, TextInput } from '../../ui';

export function IdentityUsersPage() {
	useDocumentTitle('Users — NestIdP Admin');
	const [loading, setLoading] = useState(true);
	const [filterBusy, setFilterBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [search, setSearch] = useState('');
	const [origin, setOrigin] = useState('');
	const [items, setItems] = useState<Awaited<ReturnType<typeof listIdentityUsers>>['items']>([]);
	const [total, setTotal] = useState(0);

	async function load(query: string, originFilter: string, options?: { fromFilter?: boolean }) {
		if (options?.fromFilter) {
			setFilterBusy(true);
		}
		setLoading(true);
		setError(null);
		try {
			const data = await listIdentityUsers({
				search: query || undefined,
				origin: originFilter || undefined,
				limit: 50,
			});
			setItems(data.items);
			setTotal(data.total);
		} catch (err) {
			setError(err instanceof AdminApiError ? err.message : 'Failed to load users');
		} finally {
			setLoading(false);
			setFilterBusy(false);
		}
	}

	useEffect(() => {
		void load('', '');
	}, []);

	function handleSearch(event: FormEvent) {
		event.preventDefault();
		void load(search, origin, { fromFilter: true });
	}

	const filterDisabled = filterBusy;

	return (
		<section>
			<AdminPageHeader
				title="Users"
				subtitle={`${total} total`}
				breadcrumbs={[
					{ label: 'Dashboard', to: '/admin' },
					{ label: 'Identity', to: `${IDENTITY_ROUTE_PREFIX}/users` },
					{ label: 'Users' },
				]}
				actions={
					<ButtonLink to={IDENTITY_USER_NEW_ROUTE} variant="primary">
						Create manual user
					</ButtonLink>
				}
			/>
			<Panel title="Two sources of users" className="evg-identity-callout">
				<p>
					Records from <strong>identity sync</strong> (API connection) are read-only here — change
					them in your external API, then run sync. <strong>Manual</strong> users live in the local
					directory and are managed on this site. Manual users are never updated or deactivated by
					sync.
				</p>
				<p>
					<Link to={API_CONNECTION_ROUTE_PREFIX}>API connections</Link>
					{' · '}
					<Link to={IDENTITY_USER_NEW_ROUTE}>Create manual user</Link>
				</p>
			</Panel>
			<form
				className="evg-inline-form"
				role="search"
				aria-label="Filter users"
				aria-busy={filterBusy}
				onSubmit={handleSearch}
			>
				<TextInput
					label="Search"
					fieldClassName="evg-field--grow"
					placeholder="Search username or email"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					disabled={filterDisabled}
				/>
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
			{!loading && !error && items.length === 0 ? (
				<EmptyState
					title="No users"
					description="Run identity sync or create a manual user."
					action={
						<ButtonLink to={IDENTITY_USER_NEW_ROUTE} variant="primary">
							Create manual user
						</ButtonLink>
					}
				/>
			) : null}
			{!loading && !error && items.length > 0 ? (
				<div className="evg-table-wrap">
					<Table>
						<thead>
							<tr>
								<th>Username</th>
								<th>Email</th>
								<th>Origin</th>
								<th>Active</th>
							</tr>
						</thead>
						<tbody>
							{items.map((user) => (
								<tr key={user.id}>
									<td>
										<Link to={`${IDENTITY_ROUTE_PREFIX}/users/${user.id}`}>{user.username}</Link>
									</td>
									<td>{user.email ?? '—'}</td>
									<td>
										<Badge variant={identityOriginToBadge(user.origin)}>
											{identityOriginLabel(user.origin)}
										</Badge>
									</td>
									<td>{user.active ? 'Yes' : 'No'}</td>
								</tr>
							))}
						</tbody>
					</Table>
				</div>
			) : null}
			<IdentitySectionNav current="users" />
		</section>
	);
}
