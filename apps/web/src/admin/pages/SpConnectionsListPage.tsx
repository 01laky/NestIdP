import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SP_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminApiError, listSpConnections } from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import { Table } from '../../ui';

export function SpConnectionsListPage() {
	const { t } = useTranslation('spConnections');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	useAdminDocumentTitle(t('listTitle'));
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [items, setItems] = useState<Awaited<ReturnType<typeof listSpConnections>>['items']>([]);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const data = await listSpConnections();
				if (!cancelled) {
					setItems(data.items);
				}
			} catch (err) {
				if (!cancelled) {
					setError(
						err instanceof AdminApiError
							? formatAdminApiError(
									err.statusCode,
									err.message,
									resolveI18nKey,
									'spConnections.loadListFailed',
								)
							: t('loadListFailed'),
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
	}, [t]);

	return (
		<section>
			<AdminPageHeader
				title={t('listTitle')}
				subtitle={t('listSubtitle')}
				breadcrumbs={[{ label: tNav('dashboard'), to: '/admin' }, { label: t('listTitle') }]}
				actions={
					<Link className="evg-btn evg-btn--link" to={`${SP_CONNECTION_ROUTE_PREFIX}/new`}>
						{t('newSp')}
					</Link>
				}
			/>
			{loading ? <LoadingState /> : null}
			{error ? <ErrorBanner message={error} /> : null}
			{!loading && !error && items.length === 0 ? (
				<EmptyState
					title={t('noConnections')}
					description={t('noConnectionsDescription')}
					action={
						<Link className="evg-btn evg-btn--link" to={`${SP_CONNECTION_ROUTE_PREFIX}/new`}>
							{t('createSp')}
						</Link>
					}
				/>
			) : null}
			{!loading && !error && items.length > 0 ? (
				<Table>
					<thead>
						<tr>
							<th>{tCommon('name')}</th>
							<th>{t('tableEntityId')}</th>
							<th>{t('tableActive')}</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{items.map((item) => (
							<tr key={item.id}>
								<td>{item.name}</td>
								<td>
									<code>{item.spEntityId}</code>
								</td>
								<td>{item.active ? tCommon('yes') : tCommon('no')}</td>
								<td>
									<Link to={`${SP_CONNECTION_ROUTE_PREFIX}/${item.id}`}>{tCommon('edit')}</Link> ·{' '}
									<Link to={`${SP_CONNECTION_ROUTE_PREFIX}/${item.id}/test-sso`}>
										{t('testSsoLink')}
									</Link>
								</td>
							</tr>
						))}
					</tbody>
				</Table>
			) : null}
		</section>
	);
}
