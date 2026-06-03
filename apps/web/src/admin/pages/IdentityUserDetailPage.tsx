import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AUDIT_ROUTE_PREFIX, IDENTITY_ROUTE_PREFIX, identityUserEditRoute } from '@nestidp/shared';
import { AdminApiError, deleteIdentityUser, getIdentityUser } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { identityOriginLabel, identityOriginToBadge } from '../status-badge';
import { Badge, Button, Panel, useToast } from '../../ui';

export function IdentityUserDetailPage() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const { showToast } = useToast();
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
				const data = await getIdentityUser(id, { auditLimit: 5 });
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

	async function handleDelete() {
		if (!detail || !id) {
			return;
		}
		if (!window.confirm(`Delete manual user "${detail.user.username}"?`)) {
			return;
		}
		try {
			await deleteIdentityUser(id);
			showToast('User deleted');
			navigate(`${IDENTITY_ROUTE_PREFIX}/users`);
		} catch (err) {
			setError(err instanceof AdminApiError ? err.message : 'Delete failed');
		}
	}

	if (loading) {
		return <LoadingState />;
	}

	if (error) {
		return <ErrorBanner message={error} />;
	}

	if (!detail) {
		return <ErrorBanner message="User not found" />;
	}

	const { user, groups, roles, source, recentAudit } = detail;
	const isManual = user.origin === 'manual';

	return (
		<section>
			<AdminPageHeader
				title={user.username}
				breadcrumbs={[
					{ label: 'Dashboard', to: '/admin' },
					{ label: 'Users', to: `${IDENTITY_ROUTE_PREFIX}/users` },
					{ label: user.username },
				]}
				actions={
					isManual ? (
						<>
							<Link className="evg-btn evg-btn--secondary" to={identityUserEditRoute(user.id)}>
								Edit
							</Link>
							<Button type="button" variant="danger" onClick={() => void handleDelete()}>
								Delete
							</Button>
						</>
					) : null
				}
			/>
			<p>
				<Badge variant={identityOriginToBadge(user.origin)}>
					{identityOriginLabel(user.origin)}
				</Badge>
			</p>
			<Panel title="Source">
				{source.kind === 'local_directory' ? (
					<p>Local directory (manual)</p>
				) : (
					<p>
						Synced from <strong>{source.label}</strong>
						{source.apiConnectionRoute ? (
							<>
								{' '}
								<Link className="evg-btn evg-btn--link" to={source.apiConnectionRoute}>
									View API connection
								</Link>
							</>
						) : null}
					</p>
				)}
			</Panel>
			<ul className="evg-dl">
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
			<Panel title={`Groups (${groups.length})`}>
				<ul className="evg-list">
					{groups.map((group) => (
						<li key={group.id}>
							<Link to={`${IDENTITY_ROUTE_PREFIX}/groups/${group.id}`}>{group.name}</Link>
						</li>
					))}
				</ul>
			</Panel>
			<Panel title={`Roles (${roles.length})`}>
				<ul className="evg-list">
					{roles.map((role) => (
						<li key={role.id}>
							<Link to={`${IDENTITY_ROUTE_PREFIX}/roles/${role.id}`}>{role.name}</Link>
						</li>
					))}
				</ul>
			</Panel>
			{recentAudit && recentAudit.length > 0 ? (
				<Panel title="Recent changes">
					<ul className="evg-list">
						{recentAudit.map((row) => (
							<li key={row.id}>
								<code>{row.event}</code> — {new Date(row.createdAt).toLocaleString()}
								{row.actorLabel ? ` (${row.actorLabel})` : ''}
							</li>
						))}
					</ul>
					<p>
						<Link className="evg-btn evg-btn--link" to={`${AUDIT_ROUTE_PREFIX}?category=identity`}>
							View full audit log
						</Link>
					</p>
				</Panel>
			) : null}
			<p>
				<Link className="evg-btn evg-btn--link" to={`${IDENTITY_ROUTE_PREFIX}/users`}>
					Back to users
				</Link>
			</p>
		</section>
	);
}
