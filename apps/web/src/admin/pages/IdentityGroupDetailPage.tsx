import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
	IDENTITY_ROUTE_PREFIX,
	identityGroupEditRoute,
	identityUserDetailRoute,
} from '@nestidp/shared';
import { AdminApiError, deleteIdentityGroup, getIdentityGroup } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { identityOriginLabel, identityOriginToBadge } from '../status-badge';
import { Badge, Button, Panel, Table, useToast } from '../../ui';

export function IdentityGroupDetailPage() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const { showToast } = useToast();
	useDocumentTitle('Group detail — NestIdP Admin');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [detail, setDetail] = useState<Awaited<ReturnType<typeof getIdentityGroup>> | null>(null);

	useEffect(() => {
		if (!id) {
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const data = await getIdentityGroup(id);
				if (!cancelled) {
					setDetail(data);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof AdminApiError ? err.message : 'Failed to load group');
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
				? `Delete group "${detail.group.name}"? ${detail.memberCount} user(s) are members.`
				: `Delete group "${detail.group.name}"?`;
		if (!window.confirm(msg)) {
			return;
		}
		try {
			await deleteIdentityGroup(id);
			showToast('Group deleted');
			navigate(`${IDENTITY_ROUTE_PREFIX}/groups`);
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
		return <ErrorBanner message="Group not found" />;
	}

	const { group, members, memberCount } = detail;
	const isManual = group.origin === 'manual';

	return (
		<section>
			<AdminPageHeader
				title={group.name}
				breadcrumbs={[
					{ label: 'Dashboard', to: '/admin' },
					{ label: 'Groups', to: `${IDENTITY_ROUTE_PREFIX}/groups` },
					{ label: group.name },
				]}
				actions={
					isManual ? (
						<>
							<Link className="evg-btn evg-btn--secondary" to={identityGroupEditRoute(group.id)}>
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
				<Badge variant={identityOriginToBadge(group.origin)}>
					{identityOriginLabel(group.origin)}
				</Badge>
			</p>
			<ul className="evg-dl">
				<li>
					<span>External ID</span>
					<code>{group.externalId}</code>
				</li>
				<li>
					<span>Members</span>
					<code>{memberCount}</code>
				</li>
			</ul>
			{!isManual ? (
				<p className="evg-callout evg-callout--info">
					To remove users from this synced group, edit each <strong>manual</strong> user’s group
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
				<Link className="evg-btn evg-btn--link" to={`${IDENTITY_ROUTE_PREFIX}/groups`}>
					Back to groups
				</Link>
			</p>
		</section>
	);
}
