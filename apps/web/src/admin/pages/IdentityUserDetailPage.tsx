import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AUDIT_ROUTE_PREFIX, IDENTITY_ROUTE_PREFIX, identityUserEditRoute } from '@nestidp/shared';
import { AdminApiError, deleteIdentityUser, getIdentityUser } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import { identityOriginLabel, identityOriginToBadge } from '../status-badge';
import { Badge, Button, ButtonLink, Panel, useToast } from '../../ui';

export function IdentityUserDetailPage() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const { showToast } = useToast();
	const { t } = useTranslation('identity');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	useAdminDocumentTitle(t('viewUser'));
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
					setError(
						err instanceof AdminApiError
							? formatAdminApiError(
									err.statusCode,
									err.message,
									resolveI18nKey,
									'identity.loadUserFailed',
								)
							: t('loadUserFailed'),
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
		if (!window.confirm(t('confirmDeleteUser', { name: detail.user.username }))) {
			return;
		}
		try {
			await deleteIdentityUser(id);
			showToast(t('toastUserDeleted'));
			navigate(`${IDENTITY_ROUTE_PREFIX}/users`);
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
		return <ErrorBanner message={t('userNotFound')} />;
	}

	const { user, groups, roles, source, recentAudit } = detail;
	const isManual = user.origin === 'manual';

	return (
		<section>
			<AdminPageHeader
				title={user.username}
				breadcrumbs={[
					{ label: tNav('dashboard'), to: '/admin' },
					{ label: tNav('users'), to: `${IDENTITY_ROUTE_PREFIX}/users` },
					{ label: user.username },
				]}
				actions={
					isManual ? (
						<>
							<ButtonLink variant="secondary" to={identityUserEditRoute(user.id)}>
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
				<Badge variant={identityOriginToBadge(user.origin)}>
					{identityOriginLabel(user.origin)}
				</Badge>
			</p>
			<Panel title={t('sourcePanel')}>
				{source.kind === 'local_directory' ? (
					<p>{t('localDirectory')}</p>
				) : (
					<p>
						{t('syncedFrom', { label: source.label })}
						{source.apiConnectionRoute ? (
							<>
								{' '}
								<ButtonLink variant="link" to={source.apiConnectionRoute}>
									{t('viewApiConnection')}
								</ButtonLink>
							</>
						) : null}
					</p>
				)}
			</Panel>
			<ul className="evg-dl">
				<li>
					<span>{tCommon('email')}</span>
					<code>{user.email ?? tCommon('emDash')}</code>
				</li>
				<li>
					<span>{tCommon('displayName')}</span>
					<code>{user.displayName ?? tCommon('emDash')}</code>
				</li>
				<li>
					<span>{tCommon('externalId')}</span>
					<code>{user.externalId}</code>
				</li>
				<li>
					<span>{tCommon('active')}</span>
					<code>{String(user.active)}</code>
				</li>
			</ul>
			<Panel title={t('groupsPanel', { count: groups.length })}>
				<ul className="evg-list">
					{groups.map((group) => (
						<li key={group.id}>
							<Link to={`${IDENTITY_ROUTE_PREFIX}/groups/${group.id}`}>{group.name}</Link>
						</li>
					))}
				</ul>
			</Panel>
			<Panel title={t('rolesPanel', { count: roles.length })}>
				<ul className="evg-list">
					{roles.map((role) => (
						<li key={role.id}>
							<Link to={`${IDENTITY_ROUTE_PREFIX}/roles/${role.id}`}>{role.name}</Link>
						</li>
					))}
				</ul>
			</Panel>
			{recentAudit && recentAudit.length > 0 ? (
				<Panel title={t('recentChanges')}>
					<ul className="evg-list">
						{recentAudit.map((row) => (
							<li key={row.id}>
								<code>{row.event}</code> — {new Date(row.createdAt).toLocaleString()}
								{row.actorLabel ? ` (${row.actorLabel})` : ''}
							</li>
						))}
					</ul>
					<p>
						<ButtonLink variant="link" to={`${AUDIT_ROUTE_PREFIX}?category=identity`}>
							{t('viewFullAuditLog')}
						</ButtonLink>
					</p>
				</Panel>
			) : null}
			<p>
				<ButtonLink variant="link" to={`${IDENTITY_ROUTE_PREFIX}/users`}>
					{t('backToUsers')}
				</ButtonLink>
			</p>
		</section>
	);
}
