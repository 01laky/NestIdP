import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { API_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { AdminApiError, listApiConnections } from '../adminApi';
import { AdminPageHeader } from '../components/layout/AdminPageHeader';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { LoadingState } from '../components/common/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import { Table } from '../../ui';

export function ApiConnectionsListPage() {
	const { t } = useTranslation('apiConnections');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	useAdminDocumentTitle(t('listTitle'));
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [connections, setConnections] = useState<
		Awaited<ReturnType<typeof listApiConnections>>['connections']
	>([]);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const data = await listApiConnections();
				if (!cancelled) {
					setConnections(data.connections);
				}
			} catch (err) {
				if (!cancelled) {
					setError(
						err instanceof AdminApiError
							? formatAdminApiError(
									err.statusCode,
									err.message,
									resolveI18nKey,
									'apiConnections.loadListFailed',
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
					<Link className="evg-btn evg-btn--link" to={`${API_CONNECTION_ROUTE_PREFIX}/new`}>
						{t('newConnection')}
					</Link>
				}
			/>
			{loading ? <LoadingState /> : null}
			{error ? <ErrorBanner message={error} /> : null}
			{!loading && !error && connections.length === 0 ? (
				<EmptyState
					title={t('noConnections')}
					description={t('noConnectionsDescription')}
					action={
						<Link className="evg-btn evg-btn--link" to={`${API_CONNECTION_ROUTE_PREFIX}/new`}>
							{t('createConnection')}
						</Link>
					}
				/>
			) : null}
			{!loading && !error && connections.length > 0 ? (
				<div className="evg-table-wrap">
					<Table>
						<thead>
							<tr>
								<th>{tCommon('name')}</th>
								<th>{tCommon('baseUrl')}</th>
								<th>{t('tableLastSync')}</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{connections.map((connection) => (
								<tr key={connection.id}>
									<td>{connection.name}</td>
									<td>
										<code>{connection.baseUrl}</code>
									</td>
									<td>{connection.lastSyncStatus}</td>
									<td>
										<Link to={`${API_CONNECTION_ROUTE_PREFIX}/${connection.id}`}>
											{t('editLink')}
										</Link>{' '}
										·{' '}
										<Link to={`${API_CONNECTION_ROUTE_PREFIX}/${connection.id}/sync`}>
											{tCommon('sync')}
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
