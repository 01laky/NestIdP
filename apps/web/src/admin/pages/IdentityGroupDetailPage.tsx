import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
	IDENTITY_ROUTE_PREFIX,
	identityGroupEditRoute,
	identityUserDetailRoute,
} from '@nestidp/shared';
import { AdminApiError, deleteIdentityGroup, getIdentityGroup } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import { identityOriginLabel, identityOriginToBadge } from '../status-badge';
import { Badge, Button, ButtonLink, Panel, Table, useToast } from '../../ui';

export function IdentityGroupDetailPage() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const { showToast } = useToast();
	const { t } = useTranslation('identity');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	useAdminDocumentTitle(t('viewGroup'));
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
					setError(
						err instanceof AdminApiError
							? formatAdminApiError(
									err.statusCode,
									err.message,
									resolveI18nKey,
									'identity.loadGroupFailed',
								)
							: t('loadGroupFailed'),
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
		const msg =
			detail.memberCount > 0
				? t('confirmDeleteGroupWithMembers', { name: detail.group.name, count: detail.memberCount })
				: t('confirmDeleteGroup', { name: detail.group.name });
		if (!window.confirm(msg)) {
			return;
		}
		try {
			await deleteIdentityGroup(id);
			showToast(t('toastGroupDeleted'));
			navigate(`${IDENTITY_ROUTE_PREFIX}/groups`);
		} catch (err) {
			setError(
				err instanceof AdminApiError
					? formatAdminApiError(err.statusCode, err.message, resolveI18nKey, 'errors.deleteFailed')
					: resolveI18nKey('errors.deleteFailed'),
			);
		}
	}

	if (loading) {
		return <LoadingState />;
	}
	if (error) {
		return <ErrorBanner message={error} />;
	}
	if (!detail) {
		return <ErrorBanner message={t('groupNotFound')} />;
	}

	const { group, members, memberCount } = detail;
	const isManual = group.origin === 'manual';

	return (
		<section>
			<AdminPageHeader
				title={group.name}
				breadcrumbs={[
					{ label: tNav('dashboard'), to: '/admin' },
					{ label: tNav('groups'), to: `${IDENTITY_ROUTE_PREFIX}/groups` },
					{ label: group.name },
				]}
				actions={
					isManual ? (
						<>
							<ButtonLink variant="secondary" to={identityGroupEditRoute(group.id)}>
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
				<Badge variant={identityOriginToBadge(group.origin)}>
					{identityOriginLabel(group.origin)}
				</Badge>
			</p>
			<ul className="evg-dl">
				<li>
					<span>{tCommon('externalId')}</span>
					<code>{group.externalId}</code>
				</li>
				<li>
					<span>{tCommon('members')}</span>
					<code>{memberCount}</code>
				</li>
			</ul>
			{!isManual ? (
				<p className="evg-callout evg-callout--info">{t('syncedGroupCallout')}</p>
			) : null}
			<Panel title={t('membersPanel', { count: members.length })}>
				{members.length === 0 ? (
					<p className="evg-muted">{t('noMembers')}</p>
				) : (
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
				)}
			</Panel>
			<p>
				<ButtonLink variant="link" to={`${IDENTITY_ROUTE_PREFIX}/groups`}>
					{t('backToGroups')}
				</ButtonLink>
			</p>
		</section>
	);
}
