import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { API_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import { listApiConnections, syncAllSources } from '../adminApi';
import { AdminPageHeader } from '../components/layout/AdminPageHeader';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { LoadingState } from '../components/common/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { mapAdminError } from '../../i18n/api-error-messages';
import { Button, Table, useToast } from '../../ui';

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
	const [syncingAll, setSyncingAll] = useState(false);
	const { showToast } = useToast();

	const reload = useCallback(async () => {
		const data = await listApiConnections();
		setConnections(data.connections);
	}, []);

	async function onSyncAll(dryRun: boolean) {
		setSyncingAll(true);
		try {
			const res = await syncAllSources({ dryRun });
			showToast(
				t('syncAllResult', {
					succeeded: res.totals.succeeded,
					failed: res.totals.failed,
					skipped: res.totals.skippedInProgress,
				}),
			);
			if (!dryRun) {
				await reload();
			}
		} catch (err) {
			showToast(mapAdminError(err, 'apiConnections.loadListFailed'));
		} finally {
			setSyncingAll(false);
		}
	}

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
					setError(mapAdminError(err, 'apiConnections.loadListFailed'));
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
					<div className="evg-stack inline">
						{connections.length > 0 ? (
							<>
								<Button
									type="button"
									variant="primary"
									disabled={syncingAll}
									onClick={() => void onSyncAll(false)}
								>
									{syncingAll ? t('syncAllRunning') : t('syncAllSources')}
								</Button>
								<Button
									type="button"
									variant="secondary"
									disabled={syncingAll}
									onClick={() => void onSyncAll(true)}
								>
									{t('syncAllDryRun')}
								</Button>
							</>
						) : null}
						<Link className="evg-btn evg-btn--link" to={`${API_CONNECTION_ROUTE_PREFIX}/new`}>
							{t('newConnection')}
						</Link>
					</div>
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
								<th>{t('syncSourcesTitle', { defaultValue: 'Identities' })}</th>
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
									<td>
										{connection.lastSyncStatus}
										{connection.lastCollisionCount && connection.lastCollisionCount > 0 ? (
											<>
												{' '}
												<span className="evg-muted">
													({t('lastCollisions', { count: connection.lastCollisionCount })})
												</span>
											</>
										) : null}
									</td>
									<td className="evg-muted">
										{t('syncedCounts', {
											users: connection.syncedUserCount ?? 0,
											groups: connection.syncedGroupCount ?? 0,
											roles: connection.syncedRoleCount ?? 0,
										})}
									</td>
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
