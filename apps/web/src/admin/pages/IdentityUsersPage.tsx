import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { IDENTITY_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminApiError, listIdentityUsers } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { Button, Table, TextInput } from '../../ui';

export function IdentityUsersPage() {
	useDocumentTitle('Users — NestIdP Admin');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [search, setSearch] = useState('');
	const [items, setItems] = useState<Awaited<ReturnType<typeof listIdentityUsers>>['items']>([]);
	const [total, setTotal] = useState(0);

	async function load(query: string) {
		setLoading(true);
		setError(null);
		try {
			const data = await listIdentityUsers({ search: query || undefined, limit: 50 });
			setItems(data.items);
			setTotal(data.total);
		} catch (err) {
			setError(err instanceof AdminApiError ? err.message : 'Failed to load users');
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		void load('');
	}, []);

	function handleSearch(event: FormEvent) {
		event.preventDefault();
		void load(search);
	}

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
			/>
			<form className="evg-inline-form" onSubmit={handleSearch}>
				<TextInput
					label="Search"
					labelVisuallyHidden
					placeholder="Search username or email"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
				<Button type="submit" variant="secondary">
					Search
				</Button>
			</form>
			{loading ? <LoadingState /> : null}
			{error ? <ErrorBanner message={error} /> : null}
			{!loading && !error && items.length === 0 ? (
				<EmptyState title="No users" description="Run identity sync first." />
			) : null}
			{!loading && !error && items.length > 0 ? (
				<Table>
					<thead>
						<tr>
							<th>Username</th>
							<th>Email</th>
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
								<td>{user.active ? 'Yes' : 'No'}</td>
							</tr>
						))}
					</tbody>
				</Table>
			) : null}
		</section>
	);
}
