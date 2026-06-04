import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
	IDENTITY_ROUTE_PREFIX,
	identityRoleEditRoute,
	identityUserDetailRoute,
} from '@nestidp/shared';
import { AdminApiError, deleteIdentityRole, getIdentityRole } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import { identityOriginLabel, identityOriginToBadge } from '../status-badge';
import { buildIdentityMemberDeleteDetail } from '../identity-delete-detail';
import { Badge, Button, ButtonLink, Panel, Table, useConfirmAction, useToast } from '../../ui';

export function IdentityRoleDetailPage() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const { showToast } = useToast();
	const { t } = useTranslation('identity');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	const confirmAction = useConfirmAction();
	useAdminDocumentTitle(t('viewRole'));
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
					setError(
						err instanceof AdminApiError
							? formatAdminApiError(
									err.statusCode,
									err.message,
									resolveI18nKey,
									'identity.loadRoleFailed',
								)
							: t('loadRoleFailed'),
					);
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
	}, [id, t]);

	async function handleDelete() {
		if (!detail || !id) {
			return;
		}
		const description =
			detail.memberCount > 0
				? t('confirmDeleteRoleWithMembers', {
						name: detail.role.name,
						count: detail.memberCount,
					})
				: t('confirmDeleteRole', { name: detail.role.name });
		await confirmAction({
			title: t('confirmDeleteRoleTitle'),
			description,
			detail: buildIdentityMemberDeleteDetail(detail.members, detail.memberCount, t),
			tone: 'danger',
			showAuditNote: true,
			confirmLabel: tCommon('delete'),
			onConfirm: async () => {
				try {
					await deleteIdentityRole(id);
					showToast(t('toastRoleDeleted'));
					navigate(`${IDENTITY_ROUTE_PREFIX}/roles`);
				} catch (err) {
					setError(
						err instanceof AdminApiError
							? formatAdminApiError(
									err.statusCode,
									err.message,
									resolveI18nKey,
									'errors.deleteFailed',
								)
							: resolveI18nKey('errors.deleteFailed'),
					);
				}
			},
		});
	}

	if (loading) {
		return <LoadingState />;
	}
	if (error) {
		return <ErrorBanner message={error} />;
	}
	if (!detail) {
		return <ErrorBanner message={t('roleNotFound')} />;
	}

	const { role, members, memberCount } = detail;
	const isManual = role.origin === 'manual';

	return (
		<section>
			<AdminPageHeader
				title={role.name}
				breadcrumbs={[
					{ label: tNav('dashboard'), to: '/admin' },
					{ label: tNav('roles'), to: `${IDENTITY_ROUTE_PREFIX}/roles` },
					{ label: role.name },
				]}
				actions={
					isManual ? (
						<>
							<ButtonLink variant="secondary" to={identityRoleEditRoute(role.id)}>
								{tCommon('edit')}
							</ButtonLink>
							<Button type="button" variant="danger" onClick={() => void handleDelete()}>
								{tCommon('delete')}
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
					<span>{tCommon('externalId')}</span>
					<code>{role.externalId}</code>
				</li>
				<li>
					<span>{tCommon('members')}</span>
					<code>{memberCount}</code>
				</li>
			</ul>
			{!isManual ? <p className="evg-callout evg-callout--info">{t('syncedRoleCallout')}</p> : null}
			<Panel title={t('membersPanel', { count: members.length })}>
				{members.length === 0 ? (
					<p className="evg-muted">{t('noMembers')}</p>
				) : (
					<div className="evg-table-wrap">
						<Table>
							<thead>
								<tr>
									<th>{tCommon('username')}</th>
									<th>{tCommon('origin')}</th>
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
					</div>
				)}
			</Panel>
			<p>
				<ButtonLink variant="link" to={`${IDENTITY_ROUTE_PREFIX}/roles`}>
					{t('backToRoles')}
				</ButtonLink>
			</p>
		</section>
	);
}
