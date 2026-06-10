import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SP_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { listSpConnections } from '../adminApi';
import { AdminPageHeader } from '../components/layout/AdminPageHeader';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { LoadingState } from '../components/common/LoadingState';
import { useAdminResource } from '../hooks/useAdminResource';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { Table } from '../../ui';

export function SpConnectionsListPage() {
	const { t } = useTranslation('spConnections');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	useAdminDocumentTitle(t('listTitle'));
	const { data, loading, error } = useAdminResource(listSpConnections, {
		fallbackKey: 'spConnections.loadListFailed',
	});
	const items = data?.items ?? [];

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
				<div className="evg-table-wrap">
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
				</div>
			) : null}
		</section>
	);
}
