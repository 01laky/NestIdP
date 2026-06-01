import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { IDENTITY_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminApiError, getIdentityUser } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';

export function IdentityUserDetailPage() {
	const { id } = useParams<{ id: string }>();
	useDocumentTitle('User detail — NestIdP Admin');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [detail, setDetail] = useState<Awaited<ReturnType<typeof getIdentityUser>> | null>(null);

	useEffect(() => {
		if (!id) {
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const data = await getIdentityUser(id);
				if (!cancelled) {
					setDetail(data);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof AdminApiError ? err.message : 'Failed to load user');
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
	}, [id]);

	if (loading) {
		return <LoadingState />;
	}

	if (error) {
		return <ErrorBanner message={error} />;
	}

	if (!detail) {
		return <ErrorBanner message="User not found" />;
	}

	const { user, groups, roles } = detail;

	return (
		<section>
			<AdminPageHeader
				title={user.username}
				breadcrumbs={[
					{ label: 'Dashboard', to: '/admin' },
					{ label: 'Users', to: `${IDENTITY_ROUTE_PREFIX}/users` },
					{ label: user.username },
				]}
			/>
			<ul className="admin-kv-list">
				<li>
					<span>Email</span>
					<code>{user.email ?? '—'}</code>
				</li>
				<li>
					<span>Display name</span>
					<code>{user.displayName ?? '—'}</code>
				</li>
				<li>
					<span>External ID</span>
					<code>{user.externalId}</code>
				</li>
				<li>
					<span>Active</span>
					<code>{String(user.active)}</code>
				</li>
			</ul>
			<h3>Groups ({groups.length})</h3>
			<ul className="admin-list">
				{groups.map((group) => (
					<li key={group.id}>{group.name}</li>
				))}
			</ul>
			<h3>Roles ({roles.length})</h3>
			<ul className="admin-list">
				{roles.map((role) => (
					<li key={role.id}>{role.name}</li>
				))}
			</ul>
			<p>
				<Link to={`${IDENTITY_ROUTE_PREFIX}/users`}>Back to users</Link>
			</p>
		</section>
	);
}
