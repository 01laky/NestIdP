import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
	IDENTITY_ROUTE_PREFIX,
	identityRoleEditRoute,
	identityUserDetailRoute,
} from '@nestidp/shared';
import { AdminApiError, deleteIdentityRole, getIdentityRole } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { identityOriginLabel, identityOriginToBadge } from '../status-badge';
import { Badge, Button, Panel, Table, useToast } from '../../ui';

export function IdentityRoleDetailPage() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const { showToast } = useToast();
	useDocumentTitle('Role detail — NestIdP Admin');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [detail, setDetail] = useState<Awaited<ReturnType<typeof getIdentityRole>> | null>(null);

	useEffect(() => {
		if (!id) {
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const data = await getIdentityRole(id);
				if (!cancelled) {
					setDetail(data);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof AdminApiError ? err.message : 'Failed to load role');
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
		const msg =
			detail.memberCount > 0
				? `Delete role "${detail.role.name}"? ${detail.memberCount} user(s) have this role.`
				: `Delete role "${detail.role.name}"?`;
		if (!window.confirm(msg)) {
			return;
		}
		try {
			await deleteIdentityRole(id);
			showToast('Role deleted');
			navigate(`${IDENTITY_ROUTE_PREFIX}/roles`);
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
		return <ErrorBanner message="Role not found" />;
	}

	const { role, members, memberCount } = detail;
	const isManual = role.origin === 'manual';

	return (
		<section>
			<AdminPageHeader
				title={role.name}
				breadcrumbs={[
					{ label: 'Dashboard', to: '/admin' },
					{ label: 'Roles', to: `${IDENTITY_ROUTE_PREFIX}/roles` },
					{ label: role.name },
				]}
				actions={
					isManual ? (
						<>
							<Link className="evg-btn evg-btn--secondary" to={identityRoleEditRoute(role.id)}>
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
				<Badge variant={identityOriginToBadge(role.origin)}>
					{identityOriginLabel(role.origin)}
				</Badge>
			</p>
			<ul className="evg-dl">
				<li>
					<span>External ID</span>
					<code>{role.externalId}</code>
				</li>
				<li>
					<span>Members</span>
					<code>{memberCount}</code>
				</li>
			</ul>
			{!isManual ? (
				<p className="evg-callout evg-callout--info">
					To remove users from this synced role, edit each <strong>manual</strong> user’s role
					memberships. Synced users’ memberships are controlled by identity sync.
				</p>
			) : null}
			<Panel title={`Members (${members.length})`}>
				{members.length === 0 ? (
					<p className="evg-muted">No members</p>
				) : (
					<Table>
						<thead>
							<tr>
								<th>Username</th>
								<th>Origin</th>
							</tr>
						</thead>
						<tbody>
							{members.map((member) => (
								<tr key={member.id}>
									<td>
										<Link to={identityUserDetailRoute(member.id)}>{member.username}</Link>
									</td>
									<td>
										<Badge variant={identityOriginToBadge(member.origin)}>
											{identityOriginLabel(member.origin)}
										</Badge>
									</td>
								</tr>
							))}
						</tbody>
					</Table>
				)}
			</Panel>
			<p>
				<Link className="evg-btn evg-btn--link" to={`${IDENTITY_ROUTE_PREFIX}/roles`}>
					Back to roles
				</Link>
			</p>
		</section>
	);
}
