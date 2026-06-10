import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
	type IdentityGroupListItemDto,
	type IdentityGroupMemberDto,
	identityUserDetailRoute,
} from '@nestidp/shared';
import { AdminPageHeader } from '../layout/AdminPageHeader';
import { ErrorBanner } from '../common/ErrorBanner';
import { LoadingState } from '../common/LoadingState';
import { useAdminResource } from '../../hooks/useAdminResource';
import { useAdminDocumentTitle } from '../../../i18n/useAdminDocumentTitle';
import { mapAdminError } from '../../../i18n/api-error-messages';
import { identityOriginLabel, identityOriginToBadge } from '../../status-badge';
import { buildIdentityMemberDeleteDetail } from '../../identity-delete-detail';
import { Badge, Button, ButtonLink, Panel, Table, useConfirmAction, useToast } from '../../../ui';

/**
 * Per-kind configuration for {@link IdentityMemberDetailPage} (Prompt 38 §A17 / §6.9). The group and role
 * detail pages were ~90% identical — `load` unwraps the `{ group }` / `{ role }` envelope into a common
 * `{ entity, members, memberCount }` shape (both list-item DTOs are structurally identical), and `remove`
 * deletes the record. `keys.loadFailed` is fully-qualified for {@link mapAdminError}; the rest resolve in
 * the `identity` namespace (except `navList`, in `nav`).
 */
export interface IdentityMemberDetailConfig {
	load(id: string): Promise<{
		entity: IdentityGroupListItemDto;
		members: IdentityGroupMemberDto[];
		memberCount: number;
	}>;
	remove(id: string): Promise<unknown>;
	editRoute(id: string): string;
	listPath: string;
	keys: {
		docTitle: string;
		loadFailed: string;
		notFound: string;
		navList: string;
		syncedCallout: string;
		backTo: string;
		confirmDeleteTitle: string;
		confirmDelete: string;
		confirmDeleteWithMembers: string;
		toastDeleted: string;
	};
}

/** Config-driven detail page for an identity container (group or role) and its user members. */
export function IdentityMemberDetailPage({ config }: { config: IdentityMemberDetailConfig }) {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const { showToast } = useToast();
	const { t } = useTranslation('identity');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	const confirmAction = useConfirmAction();
	const { keys } = config;
	useAdminDocumentTitle(t(keys.docTitle));
	const {
		data: detail,
		loading,
		error,
		setError,
	} = useAdminResource(() => config.load(id as string), {
		fallbackKey: keys.loadFailed,
		deps: [id],
	});

	async function handleDelete() {
		if (!detail || !id) {
			return;
		}
		const description =
			detail.memberCount > 0
				? t(keys.confirmDeleteWithMembers, {
						name: detail.entity.name,
						count: detail.memberCount,
					})
				: t(keys.confirmDelete, { name: detail.entity.name });
		await confirmAction({
			title: t(keys.confirmDeleteTitle),
			description,
			detail: buildIdentityMemberDeleteDetail(detail.members, detail.memberCount, t),
			tone: 'danger',
			showAuditNote: true,
			confirmLabel: tCommon('delete'),
			onConfirm: async () => {
				try {
					await config.remove(id);
					showToast(t(keys.toastDeleted));
					navigate(config.listPath);
				} catch (err) {
					setError(mapAdminError(err, 'errors.deleteFailed'));
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
		return <ErrorBanner message={t(keys.notFound)} />;
	}

	const { entity, members, memberCount } = detail;
	const isManual = entity.origin === 'manual';

	return (
		<section>
			<AdminPageHeader
				title={entity.name}
				breadcrumbs={[
					{ label: tNav('dashboard'), to: '/admin' },
					{ label: tNav(keys.navList), to: config.listPath },
					{ label: entity.name },
				]}
				actions={
					isManual ? (
						<>
							<ButtonLink variant="secondary" to={config.editRoute(entity.id)}>
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
				<Badge variant={identityOriginToBadge(entity.origin)}>
					{identityOriginLabel(entity.origin)}
				</Badge>
			</p>
			<ul className="evg-dl">
				<li>
					<span>{tCommon('externalId')}</span>
					<code>{entity.externalId}</code>
				</li>
				<li>
					<span>{tCommon('members')}</span>
					<code>{memberCount}</code>
				</li>
			</ul>
			{!isManual ? <p className="evg-callout evg-callout--info">{t(keys.syncedCallout)}</p> : null}
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
				<ButtonLink variant="link" to={config.listPath}>
					{t(keys.backTo)}
				</ButtonLink>
			</p>
		</section>
	);
}
