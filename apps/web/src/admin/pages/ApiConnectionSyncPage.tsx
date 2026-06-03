import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { API_CONNECTION_ROUTE_PREFIX } from '@nestidp/shared';
import {
	AdminApiError,
	getApiConnection,
	getSyncStatus,
	listSyncLogs,
	triggerIdentitySync,
} from '../adminApi';
import { AdminPageHeader } from '../components/AdminPageHeader';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingState } from '../components/LoadingState';
import { useAdminDocumentTitle } from '../../i18n/useAdminDocumentTitle';
import { formatAdminApiError, resolveI18nKey } from '../../i18n/api-error-messages';
import { Button, Checkbox, Panel, useToast } from '../../ui';

export function ApiConnectionSyncPage() {
	const { id } = useParams<{ id: string }>();
	const { t } = useTranslation('sync');
	const { t: tNav } = useTranslation('nav');
	const { t: tCommon } = useTranslation('common');
	const { t: tApi } = useTranslation('apiConnections');
	const [connectionName, setConnectionName] = useState('');
	useAdminDocumentTitle(t('title', { name: connectionName || '…' }));
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<string>('');
	const [logs, setLogs] = useState<Awaited<ReturnType<typeof listSyncLogs>>['syncLogs']>([]);
	const [dryRun, setDryRun] = useState(true);
	const [syncing, setSyncing] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const { showToast } = useToast();

	async function reload() {
		if (!id) {
			return;
		}
		const [conn, syncStatus, syncLogs] = await Promise.all([
			getApiConnection(id),
			getSyncStatus(id),
			listSyncLogs(id, 20),
		]);
		setConnectionName(conn.connection.name);
		setStatus(syncStatus.lastSyncStatus);
		setLogs(syncLogs.syncLogs);
	}

	useEffect(() => {
		if (!id) {
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				await reload();
			} catch (err) {
				if (!cancelled) {
					setError(
						err instanceof AdminApiError
							? formatAdminApiError(err.statusCode, err.message, resolveI18nKey, 'sync.loadFailed')
							: t('loadFailed'),
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
		// eslint-disable-next-line react-hooks/exhaustive-deps -- reload when id changes
	}, [id]);

	async function handleSync(event: FormEvent) {
		event.preventDefault();
		if (!id) {
			return;
		}
		setSyncing(true);
		setMessage(null);
		setError(null);
		try {
			const result = await triggerIdentitySync(id, { dryRun });
			setMessage(
				dryRun
					? t('dryRunFinished', { id: result.syncLog.id })
					: t('syncFinished', { id: result.syncLog.id }),
			);
			showToast(dryRun ? t('toastDryRunFinished') : t('toastSyncFinished'));
			await reload();
		} catch (err) {
			setError(
				err instanceof AdminApiError
					? formatAdminApiError(err.statusCode, err.message, resolveI18nKey, 'sync.syncFailed')
					: t('syncFailed'),
			);
		} finally {
			setSyncing(false);
		}
	}

	if (loading) {
		return <LoadingState />;
	}

	return (
		<section>
			<AdminPageHeader
				title={t('title', { name: connectionName })}
				breadcrumbs={[
					{ label: tNav('dashboard'), to: '/admin' },
					{ label: tApi('listTitle'), to: API_CONNECTION_ROUTE_PREFIX },
					{ label: connectionName, to: `${API_CONNECTION_ROUTE_PREFIX}/${id}` },
					{ label: tCommon('sync') },
				]}
			/>
			{error ? <ErrorBanner message={error} /> : null}
			<p className="evg-muted">{t('currentStatus', { status })}</p>
			<Panel title={t('runSync')}>
				<form
					className="evg-stack"
					aria-busy={syncing}
					onSubmit={(event) => void handleSync(event)}
				>
					<fieldset className="evg-stack" disabled={syncing}>
						<Checkbox label={t('dryRunLabel')} checked={dryRun} onChange={setDryRun} />
						<Button type="submit" variant="primary" disabled={syncing}>
							{syncing ? tCommon('running') : dryRun ? t('runDrySync') : t('runFullSync')}
						</Button>
					</fieldset>
				</form>
			</Panel>
			{message ? <p className="evg-muted">{message}</p> : null}
			<h3>{t('recentLogs')}</h3>
			{logs.length === 0 ? (
				<p className="evg-muted">{t('noSyncLogs')}</p>
			) : (
				<ul className="evg-list">
					{logs.map((log) => (
						<li key={log.id}>
							<Link to={`/admin/sync-logs/${log.id}`}>
								{log.status} — {log.startedAt}
							</Link>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
